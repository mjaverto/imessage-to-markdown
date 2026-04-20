import { describe, expect, test } from "vitest";

import { iMessageAdapter } from "../src/adapters/imessage.js";
import { signalAdapter } from "../src/adapters/signal.js";
import { telegramAdapter } from "../src/adapters/telegram.js";
import { whatsappAdapter } from "../src/adapters/whatsapp.js";

/**
 * The Signal/Telegram/WhatsApp adapters are now native (live DB / MTProto).
 * Static-fixture-based behavior tests for them have moved into
 * `test/signal-crypto.test.ts`, `test/whatsapp-epoch.test.ts`, and
 * `test/telegram-helpers.test.ts`. Here we just enforce the adapter contract
 * — each one exports an object with a unique `source` tag and a
 * loadConversations function.
 */
describe("adapter contract", () => {
  const cases: Array<{ name: string; adapter: { source: string; loadConversations: unknown } }> = [
    { name: "imessage", adapter: iMessageAdapter },
    { name: "signal", adapter: signalAdapter },
    { name: "telegram", adapter: telegramAdapter },
    { name: "whatsapp", adapter: whatsappAdapter },
  ];

  for (const { name, adapter } of cases) {
    test(`${name} adapter exposes the expected shape`, () => {
      expect(adapter.source).toBe(name);
      expect(typeof adapter.loadConversations).toBe("function");
    });
  }
});
