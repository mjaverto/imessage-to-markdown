import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3-multiple-ciphers";

import { ExportAdapter, NormalizedConversation, NormalizedMessage } from "../core/model.js";

/**
 * Native WhatsApp adapter — reads `ChatStorage.sqlite` from the WhatsApp
 * Desktop (Catalyst) Group Container. The DB is plain SQLite (no SQLCipher)
 * but live; better-sqlite3-multiple-ciphers does not honor SQLite's
 * `file:?immutable=1` URIs, so we copy the file (plus -wal / -shm sidecars)
 * to a temp dir and open the copy read-only. Same pattern the iMessage
 * adapter uses for chat.db.
 *
 * Schema (verified Apr 2026):
 *   ZWAMESSAGE        — Z_PK, ZTEXT, ZMESSAGEDATE (Mac epoch sec from 2001-01-01),
 *                       ZFROMJID, ZTOJID, ZISFROMME, ZCHATSESSION, ZGROUPMEMBER,
 *                       ZMEDIAITEM, ZPUSHNAME
 *   ZWACHATSESSION    — Z_PK, ZPARTNERNAME, ZCONTACTJID, ZSESSIONTYPE
 *   ZWAGROUPMEMBER    — Z_PK, ZCONTACTNAME, ZMEMBERJID
 *   ZWAPROFILEPUSHNAME — ZJID, ZPUSHNAME
 *   ZWAMEDIAITEM      — ZMESSAGE, ZMEDIALOCALPATH, ZTITLE
 *
 * Mac epoch conversion: JS Date = (ZMESSAGEDATE + 978307200) * 1000.
 *
 * Permissions:
 *   - Requires Full Disk Access for the binary running this tool, since
 *     `~/Library/Group Containers/...` is sandboxed.
 *   - WhatsApp Desktop must be installed and signed in.
 */

const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  "Library",
  "Group Containers",
  "group.net.whatsapp.WhatsApp.shared",
  "ChatStorage.sqlite",
);

/** Convert Apple/Mac Cocoa epoch seconds to a JS Date. */
export function macEpochToDate(seconds: number | null | undefined): Date {
  if (seconds == null || !Number.isFinite(seconds)) return new Date(0);
  return new Date((Number(seconds) + 978307200) * 1000);
}

interface WaSessionRow {
  Z_PK: number;
  ZPARTNERNAME: string | null;
  ZCONTACTJID: string | null;
  ZSESSIONTYPE: number | null;
}

interface WaGroupMemberRow {
  Z_PK: number;
  ZCHATSESSION: number | null;
  ZCONTACTNAME: string | null;
  ZMEMBERJID: string | null;
}

interface WaPushNameRow {
  ZJID: string | null;
  ZPUSHNAME: string | null;
}

interface WaMessageRow {
  Z_PK: number;
  ZTEXT: string | null;
  ZMESSAGEDATE: number | null;
  ZFROMJID: string | null;
  ZTOJID: string | null;
  ZISFROMME: number | null;
  ZCHATSESSION: number | null;
  ZGROUPMEMBER: number | null;
  ZPUSHNAME: string | null;
  ZMEDIAITEM: number | null;
  ZMEDIA_LOCAL_PATH: string | null;
  ZMEDIA_TITLE: string | null;
}

function jidToHandle(jid: string | null | undefined): string {
  if (!jid) return "";
  const at = jid.indexOf("@");
  const local = at >= 0 ? jid.slice(0, at) : jid;
  return local.split(":")[0] || local;
}

function jidToE164(jid: string | null | undefined): string {
  const local = jidToHandle(jid);
  if (/^\d{6,15}$/.test(local)) return `+${local}`;
  return local;
}

export const whatsappAdapter: ExportAdapter = {
  source: "whatsapp",
  async loadConversations(options): Promise<NormalizedConversation[]> {
    const dbPath = String(options.dbPath || DEFAULT_DB_PATH);
    const myName = String(options.myName || "Me");
    const start = options.start instanceof Date ? options.start : new Date(Date.now() - 86400000);
    const end = options.end instanceof Date ? options.end : new Date();
    const includeEmpty = Boolean(options.includeEmpty);

    if (!fs.existsSync(dbPath)) {
      throw new Error(
        `WhatsApp database not found at ${dbPath}. WhatsApp Desktop must be installed and Full Disk Access granted to this binary.`,
      );
    }

    // Copy live DB + sidecars to a temp file, then open read-only.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whatsapp-export-"));
    const safe = path.join(tmpDir, "ChatStorage.sqlite");
    fs.copyFileSync(dbPath, safe);
    for (const suffix of ["-wal", "-shm"]) {
      const source = `${dbPath}${suffix}`;
      if (fs.existsSync(source)) fs.copyFileSync(source, `${safe}${suffix}`);
    }
    const cleanup = (): void => fs.rmSync(tmpDir, { recursive: true, force: true });

    let db: Database.Database;
    try {
      db = new Database(safe, { readonly: true, fileMustExist: true });
    } catch (error) {
      cleanup();
      const message = error instanceof Error ? error.message : String(error);
      if (/database is locked/i.test(message)) {
        console.warn(`[whatsapp] Database locked, skipping this run: ${message}`);
        return [];
      }
      throw new Error(`Failed to open WhatsApp ChatStorage.sqlite: ${message}`);
    }

    try {
      const startMac = start.getTime() / 1000 - 978307200;
      const endMac = end.getTime() / 1000 - 978307200;

      const sessions = db
        .prepare(
          `SELECT Z_PK, ZPARTNERNAME, ZCONTACTJID, ZSESSIONTYPE FROM ZWACHATSESSION`,
        )
        .all() as WaSessionRow[];
      const sessionByPk = new Map(sessions.map((s) => [s.Z_PK, s]));

      const members = db
        .prepare(
          `SELECT Z_PK, ZCHATSESSION, ZCONTACTNAME, ZMEMBERJID FROM ZWAGROUPMEMBER`,
        )
        .all() as WaGroupMemberRow[];
      const memberByPk = new Map(members.map((m) => [m.Z_PK, m]));

      const pushNames = db
        .prepare(`SELECT ZJID, ZPUSHNAME FROM ZWAPROFILEPUSHNAME`)
        .all() as WaPushNameRow[];
      const pushByJid = new Map<string, string>();
      for (const row of pushNames) {
        if (row.ZJID && row.ZPUSHNAME) pushByJid.set(row.ZJID, row.ZPUSHNAME);
      }

      const messages = db
        .prepare(
          `SELECT m.Z_PK, m.ZTEXT, m.ZMESSAGEDATE, m.ZFROMJID, m.ZTOJID, m.ZISFROMME,
                  m.ZCHATSESSION, m.ZGROUPMEMBER, m.ZPUSHNAME, m.ZMEDIAITEM,
                  mi.ZMEDIALOCALPATH AS ZMEDIA_LOCAL_PATH,
                  mi.ZTITLE AS ZMEDIA_TITLE
           FROM ZWAMESSAGE m
           LEFT JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM
           WHERE m.ZMESSAGEDATE >= ? AND m.ZMESSAGEDATE < ?
           ORDER BY m.ZMESSAGEDATE ASC`,
        )
        .all(startMac, endMac) as WaMessageRow[];

      const out = new Map<string, NormalizedConversation>();
      for (const row of messages) {
        const text = (row.ZTEXT || "").trim();
        const hadAttachments = row.ZMEDIAITEM != null;
        if (!includeEmpty && !text && !hadAttachments) continue;

        const session = row.ZCHATSESSION != null ? sessionByPk.get(row.ZCHATSESSION) : undefined;
        const conversationId = session
          ? `${session.Z_PK}:${session.ZCONTACTJID || ""}`
          : `unknown:${row.Z_PK}`;
        const partnerJid = session?.ZCONTACTJID || "";
        const isGroup = partnerJid.endsWith("@g.us");
        const title = session?.ZPARTNERNAME?.trim() || jidToE164(partnerJid) || conversationId;

        const isFromMe = Number(row.ZISFROMME || 0) === 1;
        let senderHandle: string;
        if (isFromMe) {
          senderHandle = myName;
        } else if (isGroup && row.ZGROUPMEMBER != null) {
          const member = memberByPk.get(row.ZGROUPMEMBER);
          const memberJid = member?.ZMEMBERJID || "";
          const memberPush = pushByJid.get(memberJid);
          senderHandle =
            member?.ZCONTACTNAME?.trim() || memberPush || row.ZPUSHNAME?.trim() || jidToE164(memberJid) || "Unknown";
        } else {
          const fromJid = row.ZFROMJID || partnerJid;
          const push = pushByJid.get(fromJid);
          senderHandle = push || row.ZPUSHNAME?.trim() || jidToE164(fromJid) || "Unknown";
        }

        const participants = isGroup
          ? [...new Set(
              members
                .filter((m) => m.ZCHATSESSION === session?.Z_PK && m.ZMEMBERJID)
                .map((m) => jidToE164(m.ZMEMBERJID!)),
            )]
          : partnerJid
            ? [jidToE164(partnerJid)]
            : [];

        const existing = out.get(conversationId) || ({
          source: "whatsapp",
          conversationId,
          title,
          participants,
          messages: [],
          chatId: session?.Z_PK ?? null,
          service: "WhatsApp",
        } satisfies NormalizedConversation);

        const message: NormalizedMessage = {
          id: String(row.Z_PK),
          timestamp: macEpochToDate(row.ZMESSAGEDATE),
          sender: isFromMe ? myName : senderHandle,
          text,
          isFromMe,
          hadAttachments,
          attachments: hadAttachments
            ? [
                {
                  name: row.ZMEDIA_TITLE || (row.ZMEDIA_LOCAL_PATH ? path.basename(row.ZMEDIA_LOCAL_PATH) : undefined),
                  path: row.ZMEDIA_LOCAL_PATH || undefined,
                },
              ]
            : undefined,
        };
        existing.messages.push(message);
        out.set(conversationId, existing);
      }
      db.close();
      cleanup();
      return [...out.values()];
    } catch (error) {
      try {
        db.close();
      } catch {}
      cleanup();
      throw error;
    }
  },
};
