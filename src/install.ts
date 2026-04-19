#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import prompts from "prompts";
import { Command } from "commander";

import { AppConfig, CONFIG_VERSION, validateSchedule } from "./config.js";
import { runDoctor } from "./doctor.js";
import { expandHome } from "./utils.js";

const DEFAULT_INSTALL_DIR = path.join(os.homedir(), ".imessage-to-markdown");
const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), "brain", "inbox", "messages");
const DEFAULT_DB = path.join(os.homedir(), "Library", "Messages", "chat.db");
const LABEL = "ai.aver.to.imessage-to-markdown";

function buildRunnerScript(configPath: string): string {
  return `#!/bin/zsh
set -euo pipefail
CONFIG_PATH=${JSON.stringify(configPath)}
if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "Missing config: $CONFIG_PATH" >&2
  exit 1
fi
node --input-type=module <<'EOF'
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const config = JSON.parse(fs.readFileSync(process.env.CONFIG_PATH, "utf8"));
if (config.acPowerOnly) {
  const power = execFileSync("pmset", ["-g", "batt"], { encoding: "utf8" });
  if (power.includes("Battery Power")) {
    console.log("On battery power, skipping export");
    process.exit(0);
  }
}
process.chdir(config.repoDir);
const args = ["dist/cli.js", "--output-dir", config.outputDir, "--db-path", config.dbPath, "--my-name", config.myName];
if (config.excludeChatRegex) args.push("--exclude-chat-regex", config.excludeChatRegex);
if (config.includeSystem) args.push("--include-system");
if (config.includeEmpty) args.push("--include-empty");
execFileSync("node", args, { stdio: "inherit" });
if (config.runQmdEmbed && config.qmdCommand) {
  execFileSync("bash", ["-lc", config.qmdCommand], { stdio: "inherit" });
}
EOF
`;
}

function buildPlist(scriptPath: string, hour: number, minute: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${scriptPath}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>CONFIG_PATH</key>
      <string>${path.join(DEFAULT_INSTALL_DIR, "config.json")}</string>
    </dict>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key>
      <integer>${hour}</integer>
      <key>Minute</key>
      <integer>${minute}</integer>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/imessage-to-markdown.out</string>
    <key>StandardErrorPath</key>
    <string>/tmp/imessage-to-markdown.err</string>
  </dict>
</plist>
`;
}

function writeInstallFiles(config: AppConfig): { configPath: string; scriptPath: string; plistPath: string } {
  fs.mkdirSync(config.installDir, { recursive: true });
  const configPath = path.join(config.installDir, "config.json");
  const scriptPath = path.join(config.installDir, "run-export.sh");
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  fs.writeFileSync(scriptPath, buildRunnerScript(configPath), { mode: 0o755 });
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.writeFileSync(plistPath, buildPlist(scriptPath, config.scheduleHour, config.scheduleMinute));
  return { configPath, scriptPath, plistPath };
}

function currentGuiDomain(): string {
  const getuid = process.getuid;
  if (!getuid) throw new Error("process.getuid() is not available on this platform.");
  return `gui/${getuid.call(process)}`;
}

function loadLaunchAgent(plistPath: string): void {
  const domain = currentGuiDomain();
  try {
    execFileSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
  } catch {}
  execFileSync("launchctl", ["bootstrap", domain, plistPath], { stdio: "inherit" });
}

function unloadLaunchAgent(plistPath: string): void {
  const domain = currentGuiDomain();
  try {
    execFileSync("launchctl", ["bootout", domain, plistPath], { stdio: "inherit" });
  } catch {}
}

function buildConfig(input: {
  outputDir: string;
  schedule: string;
  runQmdEmbed: boolean;
  qmdCommand?: string;
  acPowerOnly: boolean;
  dbPath: string;
  myName: string;
  excludeChatRegex?: string;
  includeSystem: boolean;
  includeEmpty: boolean;
  installDir: string;
}): AppConfig {
  const { hour, minute } = validateSchedule(input.schedule);
  return {
    version: CONFIG_VERSION,
    outputDir: expandHome(input.outputDir),
    scheduleHour: hour,
    scheduleMinute: minute,
    runQmdEmbed: input.runQmdEmbed,
    qmdCommand: input.qmdCommand,
    acPowerOnly: input.acPowerOnly,
    dbPath: expandHome(input.dbPath),
    myName: input.myName,
    excludeChatRegex: input.excludeChatRegex || undefined,
    includeSystem: input.includeSystem,
    includeEmpty: input.includeEmpty,
    installDir: expandHome(input.installDir),
    repoDir: process.cwd(),
  };
}

async function resolveConfig(): Promise<AppConfig> {
  const program = new Command();
  program
    .option("--output-dir <path>")
    .option("--schedule <hh:mm>", "Daily schedule time", "05:30")
    .option("--run-qmd-embed")
    .option("--qmd-command <command>")
    .option("--ac-power-only")
    .option("--db-path <path>", undefined, DEFAULT_DB)
    .option("--my-name <name>", "Mike")
    .option("--exclude-chat-regex <regex>")
    .option("--include-system")
    .option("--include-empty")
    .option("--install-dir <path>", DEFAULT_INSTALL_DIR)
    .option("--yes", "Skip prompts")
    .option("--doctor", "Run dependency/path checks before installing")
    .option("--uninstall", "Remove installed launchd job and local install files");
  program.parse(process.argv);
  const cli = program.opts();

  if (cli.uninstall) {
    const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
    unloadLaunchAgent(plistPath);
    fs.rmSync(expandHome(String(cli.installDir || DEFAULT_INSTALL_DIR)), { recursive: true, force: true });
    fs.rmSync(plistPath, { force: true });
    console.log("Uninstalled imessage-to-markdown launchd job.");
    process.exit(0);
  }

  if (cli.doctor) {
    const doctor = runDoctor(expandHome(String(cli.dbPath || DEFAULT_DB)));
    for (const warning of doctor.warnings) console.log(`- ${warning}`);
  }

  if (cli.yes) {
    return buildConfig({
      outputDir: cli.outputDir || DEFAULT_OUTPUT_DIR,
      schedule: cli.schedule,
      runQmdEmbed: Boolean(cli.runQmdEmbed),
      qmdCommand: cli.qmdCommand,
      acPowerOnly: Boolean(cli.acPowerOnly),
      dbPath: String(cli.dbPath || DEFAULT_DB),
      myName: cli.myName,
      excludeChatRegex: cli.excludeChatRegex,
      includeSystem: Boolean(cli.includeSystem),
      includeEmpty: Boolean(cli.includeEmpty),
      installDir: cli.installDir || DEFAULT_INSTALL_DIR,
    });
  }

  const response = await prompts([
    {
      type: "text",
      name: "outputDir",
      message: "Where should exported markdown messages go?",
      initial: cli.outputDir || DEFAULT_OUTPUT_DIR,
    },
    {
      type: "text",
      name: "schedule",
      message: "What time should it run each day? (HH:MM)",
      initial: cli.schedule || "05:30",
      validate: (value: string) => {
        try {
          validateSchedule(value);
          return true;
        } catch (error) {
          return error instanceof Error ? error.message : "Invalid schedule";
        }
      },
    },
    {
      type: "confirm",
      name: "acPowerOnly",
      message: "Only run when the Mac is on AC power?",
      initial: true,
    },
    {
      type: "confirm",
      name: "runQmdEmbed",
      message: "Run qmd embed after export?",
      initial: false,
    },
    {
      type: (prev: boolean) => (prev ? "text" : null),
      name: "qmdCommand",
      message: "Command to run after export",
      initial: cli.qmdCommand || "qmd embed",
    },
    {
      type: "text",
      name: "myName",
      message: "What should sent messages be labeled as?",
      initial: cli.myName || "Mike",
    },
    {
      type: "text",
      name: "excludeChatRegex",
      message: "Regex for chats to skip, leave blank for none",
      initial: cli.excludeChatRegex || "Amazon|CVS|verification|OTP",
    },
  ]);

  return buildConfig({
    outputDir: response.outputDir || cli.outputDir || DEFAULT_OUTPUT_DIR,
    schedule: response.schedule || cli.schedule,
    runQmdEmbed: Boolean(response.runQmdEmbed),
    qmdCommand: response.qmdCommand || cli.qmdCommand,
    acPowerOnly: Boolean(response.acPowerOnly),
    dbPath: cli.dbPath || DEFAULT_DB,
    myName: response.myName || cli.myName || "Mike",
    excludeChatRegex: response.excludeChatRegex || cli.excludeChatRegex,
    includeSystem: Boolean(cli.includeSystem),
    includeEmpty: Boolean(cli.includeEmpty),
    installDir: cli.installDir || DEFAULT_INSTALL_DIR,
  });
}

export async function main(): Promise<void> {
  const config = await resolveConfig();
  const doctor = runDoctor(config.dbPath);
  for (const warning of doctor.warnings) console.log(`- ${warning}`);
  const { plistPath, configPath } = writeInstallFiles(config);
  loadLaunchAgent(plistPath);
  console.log(`Installed launchd agent: ${LABEL}`);
  console.log(`Config: ${configPath}`);
  console.log(`Output dir: ${config.outputDir}`);
  console.log(`Repo dir: ${config.repoDir}`);
  console.log(`Schedule: ${String(config.scheduleHour).padStart(2, "0")}:${String(config.scheduleMinute).padStart(2, "0")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
