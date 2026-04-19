import fs from "node:fs";
import path from "node:path";

import { ExportAdapter, NormalizedConversation } from "../core/model.js";

function flattenText(text: unknown): string {
  if (typeof text === "string") return text;
  if (Array.isArray(text)) return text.map(flattenText).join("");
  if (text && typeof text === "object" && "text" in text) return flattenText((text as { text: unknown }).text);
  return "";
}

export const telegramAdapter: ExportAdapter = {
  source: "telegram",
  async loadConversations(options): Promise<NormalizedConversation[]> {
    const exportPath = String(options.exportPath);
    const stat = fs.statSync(exportPath);
    const files = stat.isDirectory()
      ? fs.readdirSync(exportPath).filter((name) => name.endsWith(".json")).map((name) => path.join(exportPath, name))
      : [exportPath];

    const conversations: NormalizedConversation[] = [];
    for (const file of files) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!Array.isArray(data.messages)) continue;
      conversations.push({
        source: "telegram",
        conversationId: String(data.id || file),
        title: String(data.name || path.basename(file, ".json")),
        participants: [],
        messages: data.messages.map((message: Record<string, unknown>) => ({
          id: String(message.id),
          timestamp: new Date(String(message.date)),
          sender: String(message.from || "Unknown"),
          text: flattenText(message.text),
          isFromMe: false,
          hadAttachments: Boolean(message.file || message.photo),
        })),
      });
    }
    return conversations;
  },
};
