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

export function runDoctor(source: string, dbPath: string, exportPath?: string): DoctorCheckResult {
  const warnings: string[] = [];

  if (!hasCommand("node")) warnings.push("Node.js is not on PATH.");
  if (source === "imessage") {
    if (!hasCommand("sqlite3")) warnings.push("sqlite3 is not on PATH. The iMessage adapter shells out to sqlite3 to read chat.db.");
    if (!fs.existsSync(dbPath)) warnings.push(`Messages database not found at ${dbPath}. Full Disk Access or path may be wrong.`);
    warnings.push("Reminder: the terminal or app running this tool needs Full Disk Access to read ~/Library/Messages/chat.db.");
  } else if (exportPath && !fs.existsSync(exportPath)) {
    warnings.push(`Export path not found at ${exportPath}.`);
  }

  return {
    ok: warnings.length === 0,
    warnings,
  };
}
