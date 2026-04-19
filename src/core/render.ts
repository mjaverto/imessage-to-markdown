import { NormalizedConversation, NormalizedMessage } from "./model.js";
import { sanitizeFilename } from "../utils.js";

export interface RenderedFile {
  relativePath: string;
  content: string;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderLine(message: NormalizedMessage): string {
  const hh = String(message.timestamp.getHours()).padStart(2, "0");
  const mm = String(message.timestamp.getMinutes()).padStart(2, "0");
  const text = message.text.trim() || "[no text]";
  const attachmentNote = message.hadAttachments ? " [attachments omitted]" : "";
  return `- ${hh}:${mm} ${message.sender}: ${text}${attachmentNote}`;
}

export function renderConversationDays(conversation: NormalizedConversation): RenderedFile[] {
  const buckets = new Map<string, NormalizedMessage[]>();
  for (const message of conversation.messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())) {
    const key = dateKey(message.timestamp);
    const list = buckets.get(key) || [];
    list.push(message);
    buckets.set(key, list);
  }

  return [...buckets.entries()].map(([key, messages]) => {
    const safeTitle = sanitizeFilename(conversation.title || conversation.conversationId, conversation.conversationId);
    const lines = [
      `# ${conversation.title}`,
      `Source: ${conversation.source}`,
      `Date: ${key}`,
      "",
      ...messages.map(renderLine),
      "",
    ];
    return {
      relativePath: `${conversation.source}/${key}/${safeTitle}.md`,
      content: lines.join("\n"),
    };
  });
}
