import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { signalAdapter } from "../src/adapters/signal.js";
import { telegramAdapter } from "../src/adapters/telegram.js";
import { whatsappAdapter } from "../src/adapters/whatsapp.js";

function withTempFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msg-adapter-test-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, "utf8");
  return file;
}

describe("telegram adapter", () => {
  test("loads exported json", async () => {
    const file = withTempFile("chat.json", JSON.stringify({
      id: 1,
      name: "Saved Messages",
      messages: [{ id: 10, date: "2026-04-19T10:00:00", from: "Mike", text: "hello" }],
    }));
    const conversations = await telegramAdapter.loadConversations({ exportPath: file });
    expect(conversations[0]?.title).toBe("Saved Messages");
    expect(conversations[0]?.messages[0]?.text).toBe("hello");
  });
});

describe("whatsapp adapter", () => {
  test("parses txt export", async () => {
    const file = withTempFile("chat.txt", "4/19/2026, 10:00 - Mike: hello there");
    const conversations = await whatsappAdapter.loadConversations({ exportPath: file });
    expect(conversations[0]?.messages[0]?.sender).toBe("Mike");
  });
});

describe("signal adapter", () => {
  test("parses markdown export", async () => {
    const file = withTempFile("chat.md", "[2026-04-19 10:00] Me: hi signal");
    const conversations = await signalAdapter.loadConversations({ exportPath: file });
    expect(conversations[0]?.messages[0]?.text).toBe("hi signal");
  });
});
