import { describe, expect, test } from "vitest";

import { jidToHandle, macEpochToDate, parseJid } from "../src/adapters/whatsapp.js";

describe("macEpochToDate", () => {
  test("Mac epoch 0 is 2001-01-01 UTC", () => {
    expect(macEpochToDate(0).toISOString()).toBe("2001-01-01T00:00:00.000Z");
  });

  test("converts a known 2024 timestamp", () => {
    // 2024-06-15T12:00:00Z -> 1718452800 unix -> 740145600 mac
    expect(macEpochToDate(740_145_600).toISOString()).toBe("2024-06-15T12:00:00.000Z");
  });

  test("accepts numeric string input", () => {
    expect(macEpochToDate("740145600").toISOString()).toBe("2024-06-15T12:00:00.000Z");
  });

  test("null / undefined / empty default to Mac epoch origin", () => {
    expect(macEpochToDate(null).toISOString()).toBe("2001-01-01T00:00:00.000Z");
    expect(macEpochToDate(undefined).toISOString()).toBe("2001-01-01T00:00:00.000Z");
  });
});

describe("parseJid", () => {
  test("parses a 1:1 user JID", () => {
    const parsed = parseJid("15705551234@s.whatsapp.net");
    expect(parsed).toMatchObject({ user: "15705551234", server: "s.whatsapp.net", isGroup: false });
    expect(parsed.groupAuthor).toBeUndefined();
  });

  test("parses a group JID with no inner author", () => {
    const parsed = parseJid("15705550000-1234567890@g.us");
    expect(parsed.isGroup).toBe(true);
    expect(parsed.server).toBe("g.us");
  });

  test("parses a participant-in-group JID (underscore-encoded author)", () => {
    const parsed = parseJid("15705559999_1234567890@g.us");
    expect(parsed.isGroup).toBe(true);
    expect(parsed.groupAuthor).toBe("15705559999");
    expect(parsed.user).toBe("15705559999");
  });

  test("empty / malformed input returns empty JID", () => {
    expect(parseJid("").user).toBe("");
    expect(parseJid(null).user).toBe("");
    expect(parseJid("garbage").user).toBe("");
  });

  test("jidToHandle returns digits for Contacts lookup", () => {
    expect(jidToHandle("15705551234@s.whatsapp.net")).toBe("15705551234");
    expect(jidToHandle("15705559999_1234567890@g.us")).toBe("15705559999");
  });
});
