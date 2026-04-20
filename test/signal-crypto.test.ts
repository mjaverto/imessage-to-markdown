import crypto from "node:crypto";

import { describe, expect, test } from "vitest";

import { decryptSignalKey } from "../src/adapters/signal.js";

/**
 * Round-trip tests for the Chromium safeStorage scheme used by Signal Desktop.
 * We don't have a known public test vector, so we encrypt a plausible
 * SQLCipher key with the documented algorithm and verify decryptSignalKey
 * recovers it. Any drift in PBKDF2 params, IV, or the magic prefix breaks
 * this round trip.
 */

function encryptForSignal(plaintextHexKey: string, keychainPassword: string, magic: "v10" | "v11"): string {
  const aesKey = crypto.pbkdf2Sync(
    Buffer.from(keychainPassword, "utf8"),
    "saltysalt",
    1003,
    16,
    "sha1",
  );
  const iv = Buffer.alloc(16, 0x20);
  const cipher = crypto.createCipheriv("aes-128-cbc", aesKey, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plaintextHexKey, "utf8")), cipher.final()]);
  return Buffer.concat([Buffer.from(magic), enc]).toString("hex");
}

describe("decryptSignalKey", () => {
  test("round-trips a 64-char hex key with v10 magic", () => {
    const password = "57JSLmozAFlQqwvl/0fmLQ=="; // sample b64 keychain string
    const plaintext = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const encrypted = encryptForSignal(plaintext, password, "v10");
    expect(decryptSignalKey(encrypted, password)).toBe(plaintext);
  });

  test("round-trips with v11 magic prefix", () => {
    const password = "anotherbase64keychainvalueXY==";
    const plaintext = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    const encrypted = encryptForSignal(plaintext, password, "v11");
    expect(decryptSignalKey(encrypted, password)).toBe(plaintext);
  });

  test("rejects unknown magic prefix", () => {
    const password = "57JSLmozAFlQqwvl/0fmLQ==";
    const plaintext = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const encrypted = encryptForSignal(plaintext, password, "v10");
    // Tamper the magic
    const tampered = Buffer.from(encrypted, "hex");
    tampered[0] = 0x77; // 'w' instead of 'v'
    expect(() => decryptSignalKey(tampered.toString("hex"), password)).toThrow(/magic/);
  });

  test("rejects wrong password", () => {
    const password = "correct-password";
    const plaintext = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const encrypted = encryptForSignal(plaintext, password, "v10");
    expect(() => decryptSignalKey(encrypted, "wrong-password")).toThrow();
  });
});
