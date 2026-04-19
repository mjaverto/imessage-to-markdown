import fs from "node:fs";
import path from "node:path";

import { ExportAdapter, NormalizedConversation } from "../core/model.js";

const LINE_RE = /^\[(.+?)\]\s+([^:]+):\s+(.*)$/;

export const signalAdapter: ExportAdapter = {
  source: "signal",
  async loadConversations(options): Promise<NormalizedConversation[]> {
    const exportPath = String(options.exportPath);
    const files = fs.statSync(exportPath).isDirectory()
      ? fs.readdirSync(exportPath).filter((name) => name.endsWith(".md")).map((name) => path.join(exportPath, name))
      : [exportPath];

    return files.map((file) => {
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      const messages = [];
      for (const line of lines) {
        const match = line.match(LINE_RE);
        if (!match) continue;
        const [, ts, sender, text] = match;
        messages.push({
          id: `${ts}-${messages.length}`,
          timestamp: new Date(ts.replace(",", "")),
          sender,
          text,
          isFromMe: sender === "Me",
          hadAttachments: /\]\(.+\)|!\[.*\]\(.+\)/.test(text),
        });
      }
      return {
        source: "signal",
        conversationId: path.basename(file, ".md"),
        title: path.basename(file, ".md"),
        participants: [],
        messages,
      } satisfies NormalizedConversation;
    });
  },
};
