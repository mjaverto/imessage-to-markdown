import fs from "node:fs";
import { execFileSync } from "node:child_process";

export interface DoctorCheckResult {
  ok: boolean;
  warnings: string[];
}

function hasCommand(command: string): boolean {
  try {
    execFileSync("bash", ["-lc", `command -v ${command}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function runDoctor(dbPath: string): DoctorCheckResult {
  const warnings: string[] = [];

  if (!hasCommand("node")) warnings.push("Node.js is not on PATH.");
  if (!hasCommand("sqlite3")) warnings.push("sqlite3 is not on PATH. This tool shells out to sqlite3 to read chat.db.");
  if (!fs.existsSync(dbPath)) warnings.push(`Messages database not found at ${dbPath}. Full Disk Access or path may be wrong.`);
  warnings.push("Reminder: the terminal or app running this tool needs Full Disk Access to read ~/Library/Messages/chat.db.");

  return {
    ok: warnings.length <= 1,
    warnings,
  };
}
