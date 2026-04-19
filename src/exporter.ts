import fs from "node:fs";
import path from "node:path";

import { iMessageAdapter } from "./adapters/imessage.js";
import { signalAdapter } from "./adapters/signal.js";
import { telegramAdapter } from "./adapters/telegram.js";
import { whatsappAdapter } from "./adapters/whatsapp.js";
import { renderConversationDays } from "./core/render.js";
import { ExportAdapter } from "./core/model.js";

const adapters = new Map<string, ExportAdapter>([
  [iMessageAdapter.source, iMessageAdapter],
  [telegramAdapter.source, telegramAdapter],
  [whatsappAdapter.source, whatsappAdapter],
  [signalAdapter.source, signalAdapter],
]);

export async function exportFromSource(source: string, options: Record<string, unknown>): Promise<{ filesWritten: number; outputPaths: string[] }> {
  const adapter = adapters.get(source);
  if (!adapter) throw new Error(`Unknown source: ${source}`);
  const outputDir = String(options.outputDir || "./exports");
  const conversations = await adapter.loadConversations(options);
  const outputPaths: string[] = [];
  fs.mkdirSync(outputDir, { recursive: true });
  for (const conversation of conversations) {
    for (const rendered of renderConversationDays(conversation)) {
      const fullPath = path.join(outputDir, rendered.relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, rendered.content, "utf8");
      outputPaths.push(fullPath);
    }
  }
  return { filesWritten: outputPaths.length, outputPaths };
}
