import fs from "node:fs";
import path from "node:path";

import { ExportAdapter, NormalizedConversation } from "../core/model.js";

const LINE_RE = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2})(?:\s?[APMapm]{2})?\s+-\s+([^:]+):\s+(.*)$/;

export const whatsappAdapter: ExportAdapter = {
  source: "whatsapp",
  async loadConversations(options): Promise<NormalizedConversation[]> {
    const exportPath = String(options.exportPath);
    const files = fs.statSync(exportPath).isDirectory()
      ? fs.readdirSync(exportPath).filter((name) => name.endsWith(".txt")).map((name) => path.join(exportPath, name))
      : [exportPath];

    return files.map((file) => {
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      const messages = [];
      for (const line of lines) {
        const match = line.match(LINE_RE);
        if (!match) continue;
        const [, date, time, sender, text] = match;
        messages.push({
          id: `${date}-${time}-${messages.length}`,
          timestamp: new Date(`${date} ${time}`),
          sender,
          text,
          isFromMe: false,
          hadAttachments: /<attached:|omitted/i.test(text),
        });
      }
      return {
        source: "whatsapp",
        conversationId: path.basename(file, ".txt"),
        title: path.basename(file, ".txt"),
        participants: [],
        messages,
      } satisfies NormalizedConversation;
    });
  },
};
