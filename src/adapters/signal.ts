import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import Database from "better-sqlite3-multiple-ciphers";

import { ExportAdapter, NormalizedConversation, NormalizedMessage } from "../core/model.js";

/**
 * Native Signal Desktop adapter — fully passive, reads the encrypted SQLCipher
 * database in-place from `~/Library/Application Support/Signal/sql/db.sqlite`.
 *
 * Key extraction (macOS):
 *   - Modern Signal Desktop encrypts the SQLCipher passphrase via Electron's
 *     `safeStorage`, which on macOS delegates to the user's login keychain
 *     under svce="Signal Safe Storage".
 *   - `config.json` stores the encrypted blob as a hex string with a 3-byte
 *     magic prefix ("v10" or "v11" — Chromium safeStorage format).
 *   - Strip the magic, then AES-128-CBC-decrypt with:
 *       password = the keychain b64 string ITSELF (utf8 bytes), NOT the b64-decoded bytes
 *       salt     = "saltysalt"
 *       iters    = 1003
 *       hash     = SHA1
 *       IV       = 16 spaces (0x20)
 *     PKCS7 padding. The decrypted plaintext is an ASCII hex string (the
 *     SQLCipher passphrase). This matches Chromium's safeStorage scheme as
 *     used by `carderne/signal-export` (sigexport/crypto.py).
 *
 * Legacy fallback:
 *   - Older Signal installs put a plain `key` field in config.json (hex
 *     string). If present we use it directly.
 *
 * SQLCipher driver:
 *   - We use `better-sqlite3-multiple-ciphers`, which defaults to the sqleet
 *     cipher. Signal uses SQLCipher v4, so we MUST set
 *       PRAGMA cipher='sqlcipher';
 *       PRAGMA legacy=4;
 *     before PRAGMA key. Without these the key is rejected with
 *     "file is not a database".
 *
 * Sonoma 14.5+ note (carderne/signal-export#133):
 *   - On Sonoma 14.5+, the keychain "Signal Safe Storage" item is sometimes
 *     re-keyed by the OS after a Signal Desktop upgrade and prompts for user
 *     consent the next time the app launches. If the user denies access,
 *     `security find-generic-password` returns a `SecKeychainSearchCopyNext`
 *     error and the adapter exits nonzero with an actionable message.
 */

const SIGNAL_HOME = path.join(os.homedir(), "Library", "Application Support", "Signal");
const DEFAULT_DB_PATH = path.join(SIGNAL_HOME, "sql", "db.sqlite");
const CONFIG_PATH = path.join(SIGNAL_HOME, "config.json");

interface SignalConfig {
  key?: string;
  encryptedKey?: string;
}

function readSignalConfig(): SignalConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `Signal config.json not found at ${CONFIG_PATH}. Is Signal Desktop installed and has it been launched at least once?`,
    );
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as SignalConfig;
}

function getKeychainPassword(): string {
  // svce="Signal Safe Storage". The acct attribute varies ("Signal" vs
  // "Signal Key" depending on Signal version) so query by service alone.
  try {
    const out = execFileSync(
      "security",
      ["find-generic-password", "-w", "-s", "Signal Safe Storage"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return out.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not read Signal Safe Storage from the macOS Keychain: ${message}\n` +
        "Open Keychain Access, search for 'Signal Safe Storage', and grant the calling tool access. " +
        "On Sonoma 14.5+ this entry can be regenerated after a Signal upgrade — see " +
        "https://github.com/carderne/signal-export/issues/133",
    );
  }
}

export function decryptSignalKey(encryptedKeyHex: string, keychainPassword: string): string {
  const blob = Buffer.from(encryptedKeyHex, "hex");
  const magic = blob.subarray(0, 3).toString();
  if (magic !== "v10" && magic !== "v11") {
    throw new Error(`Unexpected encryptedKey magic '${magic}'. Expected 'v10' or 'v11'.`);
  }
  const ciphertext = blob.subarray(3);
  // Chromium safeStorage on macOS: PBKDF2-HMAC-SHA1, salt "saltysalt",
  // 1003 iterations, 16-byte AES-128 key. The password is the b64 STRING
  // returned by `security find-generic-password`, treated as utf8 bytes.
  const aesKey = crypto.pbkdf2Sync(
    Buffer.from(keychainPassword, "utf8"),
    "saltysalt",
    1003,
    16,
    "sha1",
  );
  const iv = Buffer.alloc(16, 0x20);
  const decipher = crypto.createDecipheriv("aes-128-cbc", aesKey, iv);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const ascii = decrypted.toString("utf8");
  if (!/^[0-9a-fA-F]+$/.test(ascii)) {
    throw new Error(
      "Decrypted Signal key is not a hex string. The keychain password may be wrong or the key format changed.",
    );
  }
  return ascii;
}

export function loadSignalSqlcipherKey(): string {
  const config = readSignalConfig();
  if (config.key) return config.key; // legacy plaintext path
  if (!config.encryptedKey) {
    throw new Error(
      `Signal config.json has neither 'key' nor 'encryptedKey'. Cannot derive SQLCipher key.`,
    );
  }
  const password = getKeychainPassword();
  return decryptSignalKey(config.encryptedKey, password);
}

interface SignalConversationRow {
  id: string;
  name: string | null;
  profileFullName: string | null;
  profileName: string | null;
  e164: string | null;
  type: string | null;
  serviceId: string | null;
}

interface SignalMessageRow {
  id: string;
  conversationId: string;
  source: string | null;
  sent_at: number | null;
  received_at: number | null;
  body: string | null;
  type: string | null;
  hasAttachments: number | null;
}

function copyDbForReading(dbPath: string): { safe: string; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "signal-export-"));
  const safe = path.join(tmpDir, path.basename(dbPath));
  fs.copyFileSync(dbPath, safe);
  for (const suffix of ["-wal", "-shm"]) {
    const source = `${dbPath}${suffix}`;
    if (fs.existsSync(source)) fs.copyFileSync(source, `${safe}${suffix}`);
  }
  return { safe, cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }) };
}

function openSignalDb(safePath: string, sqlcipherKey: string): Database.Database {
  const db = new Database(safePath, { readonly: true });
  db.pragma("cipher='sqlcipher'");
  db.pragma("legacy=4");
  db.pragma(`key="x'${sqlcipherKey}'"`);
  return db;
}

function conversationDisplayName(row: SignalConversationRow): string {
  return (
    row.name?.trim() ||
    row.profileFullName?.trim() ||
    row.profileName?.trim() ||
    row.e164 ||
    row.serviceId ||
    row.id
  );
}

export const signalAdapter: ExportAdapter = {
  source: "signal",
  async loadConversations(options): Promise<NormalizedConversation[]> {
    const dbPath = String(options.dbPath || DEFAULT_DB_PATH);
    const myName = String(options.myName || "Me");
    const start = options.start instanceof Date ? options.start : new Date(Date.now() - 86400000);
    const end = options.end instanceof Date ? options.end : new Date();
    const includeEmpty = Boolean(options.includeEmpty);

    if (!fs.existsSync(dbPath)) {
      throw new Error(
        `Signal database not found at ${dbPath}. Is Signal Desktop installed?`,
      );
    }

    const sqlcipherKey = loadSignalSqlcipherKey();
    const { safe, cleanup } = copyDbForReading(dbPath);
    try {
      let db: Database.Database;
      try {
        db = openSignalDb(safe, sqlcipherKey);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/database is locked/i.test(message)) {
          // launchd / cron will retry on the next tick; non-fatal.
          console.warn(`[signal] Database locked, skipping this run: ${message}`);
          return [];
        }
        throw new Error(`Failed to open Signal SQLCipher DB: ${message}`);
      }

      const conversations = db
        .prepare(
          `SELECT id, name, profileFullName, profileName, e164, type, serviceId FROM conversations`,
        )
        .all() as SignalConversationRow[];
      const convoById = new Map(conversations.map((c) => [c.id, c]));

      const startMs = start.getTime();
      const endMs = end.getTime();
      const messages = db
        .prepare(
          `SELECT id, conversationId, source, sent_at, received_at, body, type, hasAttachments
           FROM messages
           WHERE COALESCE(sent_at, received_at) >= ? AND COALESCE(sent_at, received_at) < ?
           ORDER BY COALESCE(sent_at, received_at) ASC`,
        )
        .all(startMs, endMs) as SignalMessageRow[];

      const out = new Map<string, NormalizedConversation>();
      for (const row of messages) {
        const text = (row.body || "").trim();
        const hadAttachments = Number(row.hasAttachments || 0) > 0;
        if (!includeEmpty && !text && !hadAttachments) continue;
        const convo = convoById.get(row.conversationId);
        const title = convo ? conversationDisplayName(convo) : row.conversationId;
        const isFromMe = row.type === "outgoing";
        const senderHandle = convo?.e164 || convo?.serviceId || row.source || row.conversationId;
        const conversationId = row.conversationId;
        const existing = out.get(conversationId) || ({
          source: "signal",
          conversationId,
          title,
          participants: convo?.e164 ? [convo.e164] : convo?.serviceId ? [convo.serviceId] : [],
          messages: [],
          chatId: convo?.id ?? null,
          service: "Signal",
        } satisfies NormalizedConversation);
        const message: NormalizedMessage = {
          id: row.id,
          timestamp: new Date(Number(row.sent_at || row.received_at || 0)),
          sender: isFromMe ? myName : senderHandle,
          text,
          isFromMe,
          hadAttachments,
        };
        existing.messages.push(message);
        out.set(conversationId, existing);
      }
      db.close();
      return [...out.values()];
    } finally {
      cleanup();
    }
  },
};
