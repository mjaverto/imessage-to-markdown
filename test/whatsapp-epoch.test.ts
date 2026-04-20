import { describe, expect, test } from "vitest";

import { macEpochToDate } from "../src/adapters/whatsapp.js";

/** Cocoa/Mac epoch reference: 2001-01-01T00:00:00Z is offset 978307200 from Unix epoch. */
describe("macEpochToDate", () => {
  test("zero seconds maps to 2001-01-01T00:00:00Z", () => {
    expect(macEpochToDate(0).toISOString()).toBe("2001-01-01T00:00:00.000Z");
  });

  test("known WhatsApp message timestamp round-trips", () => {
    // 2024-01-01T00:00:00Z = 1704067200 unix = 725760000 mac-epoch
    expect(macEpochToDate(725760000).toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  test("fractional seconds preserved to ms", () => {
    expect(macEpochToDate(725760000.5).toISOString()).toBe("2024-01-01T00:00:00.500Z");
  });

  test("null and undefined map to epoch zero (defensive)", () => {
    expect(macEpochToDate(null).toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect(macEpochToDate(undefined).toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });

  test("negative seconds (pre-2001 — shouldn't happen but be defensive)", () => {
    expect(macEpochToDate(-1).toISOString()).toBe("2000-12-31T23:59:59.000Z");
  });
});
