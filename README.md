# Messaging Markdown Exporter

Export conversations from multiple messaging apps into a shared markdown format.

## Supported sources

All four adapters now read native, live data sources — no manual exports
required. Each one is fully passive and safe to run unattended from
`launchd`/`cron`.

| Source | Input |
|---|---|
| `imessage` | macOS `~/Library/Messages/chat.db` |
| `signal` | encrypted SQLCipher DB at `~/Library/Application Support/Signal/sql/db.sqlite` (key auto-extracted from Keychain) |
| `whatsapp` | macOS Group Container `ChatStorage.sqlite` (plain SQLite) |
| `telegram` | live MTProto via `gramjs`, persistent `StringSession` for unattended runs |

## Architecture

The repo is structured around three layers:

1. **Adapters**
   - one per source system
   - convert source-specific exports or databases into a normalized model

2. **Normalized model**
   - shared conversation/message representation
   - keeps rendering independent from source-specific parsing

3. **Renderer**
   - one shared markdown renderer
   - creates daily markdown files in a consistent layout

This keeps source complexity from leaking across the whole codebase.

## Install

```bash
git clone https://github.com/mjaverto/imessage-to-markdown.git
cd imessage-to-markdown
npm install
npm run build
```

Package name:
- `messaging-markdown-exporter`

CLI binaries:
- `messaging-markdown-exporter`
- `imessage-to-markdown` (legacy alias)

## CLI usage

### iMessage

```bash
node dist/cli.js \
  --source imessage \
  --db-path ~/Library/Messages/chat.db \
  --output-dir ~/brain/iMessage
```

### Signal

```bash
node dist/cli.js \
  --source signal \
  --output-dir ~/brain/Signal \
  --my-name "Mike Averto"
# Optional: override DB path
#   --signal-db-path "$HOME/Library/Application Support/Signal/sql/db.sqlite"
```

The Signal adapter:
- Reads the encrypted SQLCipher DB directly using
  `better-sqlite3-multiple-ciphers` (PRAGMA `cipher='sqlcipher'`, `legacy=4`).
- Auto-extracts the SQLCipher passphrase from the macOS Keychain entry
  `Signal Safe Storage` and decrypts the `encryptedKey` blob in
  `config.json` using Chromium's safeStorage scheme (PBKDF2-HMAC-SHA1,
  salt `saltysalt`, 1003 iterations, AES-128-CBC, IV = 16 spaces).
- Falls back to the legacy plaintext `key` field if present.
- **Sonoma 14.5+ caveat:** the Keychain entry can be regenerated after a
  Signal Desktop upgrade and may prompt for the calling tool's keychain
  access on first run. See
  [carderne/signal-export#133](https://github.com/carderne/signal-export/issues/133)
  for context. If the prompt is denied or the entry is missing, the
  adapter exits nonzero with an actionable message.

### WhatsApp

```bash
node dist/cli.js \
  --source whatsapp \
  --output-dir ~/brain/WhatsApp \
  --my-name "Mike Averto"
# Optional: override DB path
#   --whatsapp-db-path "$HOME/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite"
```

The WhatsApp adapter:
- Reads `ChatStorage.sqlite` from the WhatsApp Desktop (Catalyst) Group
  Container — plain SQLite, no decryption needed.
- Copies the live DB (plus `-wal` / `-shm`) to a temp file before opening
  it read-only, to avoid lock conflicts with the running app.
- Resolves senders via `ZWAPROFILEPUSHNAME` (then via macOS Contacts when
  enabled), and converts the Mac/Cocoa epoch (`ZMESSAGEDATE`) to JS Date.
- **Permission requirements:** WhatsApp Desktop must be installed and
  signed in. The binary running this tool needs Full Disk Access (System
  Settings → Privacy & Security → Full Disk Access) so the sandboxed
  Group Container is readable.

### Telegram

```bash
# One-time interactive setup:
node dist/cli.js telegram-login
# (You'll be prompted for apiId, apiHash, phone, login code, optional 2FA pw.)

# Then daily passive runs (cron-friendly):
node dist/cli.js \
  --source telegram \
  --output-dir ~/brain/Telegram \
  --my-name "Mike Averto"
```

The Telegram adapter:
- Uses MTProto via the `telegram` npm package (gramjs) with a persistent
  `StringSession` blob, so cron jobs reuse the same login.
- Stores credentials and session at
  `~/.config/imessage-to-markdown/telegram/{credentials.json,session.txt}`
  (`chmod 600`).
- Per-dialog read cursor at
  `~/.config/imessage-to-markdown/telegram/cursors.json` so each run
  picks up where the last left off.
- On `AUTH_KEY_UNREGISTERED` exits 0 with a loud warning (don't loop —
  user must re-run `telegram-login`).
- FloodWait-aware: catches `FloodWaitError`, sleeps `err.seconds`, retries
  once, otherwise saves partial progress and exits 0.

You'll need an `apiId`/`apiHash` from
[my.telegram.org/apps](https://my.telegram.org/apps).

## Contacts integration (iMessage)

For the `imessage` source, the exporter dumps Contacts.app once per run via
JXA and resolves chat handles (phone numbers, emails) to display names. The
resolved name is used in the markdown header, message senders, and the YAML
frontmatter.

The first run will trigger a Contacts permission prompt for the binary
running `osascript` (your terminal app, or the launchd-spawning process).
If access is denied or unavailable, the exporter logs a one-line warning
and falls back to raw handles -- exports still succeed.

Phone numbers are normalized to the last 10 digits for matching (US-centric;
documented tradeoff). Emails are lowercased and trimmed.

### Flags

- `--no-contacts` -- skip Contacts.app entirely (no permission prompt).
- `--use-contact-names` -- when set, 1:1 chat output files are named after
  the resolved contact (e.g. `Karissa Smith.md`) instead of the slugified
  handle. Group chats keep slug-based filenames. Default off for backward
  compatibility with installed runners.

## YAML frontmatter

Every generated markdown file starts with a YAML frontmatter block:

```yaml
---
contact: "Karissa Smith"          # 1:1 chats only
participants: ["Alice", "Bob"]    # group chats only
handles: ["+15705551234"]
chat_id: 42                       # source-specific stable id (iMessage ROWID)
service: "iMessage"
source: "imessage"
message_count: 12
first_message: 2026-04-19T12:30:00.000Z
last_message: 2026-04-19T18:45:00.000Z
exported_at: 2026-04-19T19:30:00.000Z
---
```

Downstream tooling (Obsidian, Dataview, custom indexers) can rely on the
shape above being stable across sources.

## Installer

The installer now supports choosing a source and scheduling export jobs.

Right now, scheduled automation is strongest for iMessage and local file-based export flows. For Telegram, WhatsApp, and Signal, the installer can schedule imports from a known export path, but it does not itself create those upstream exports.

Interactive:

```bash
npm run install:local
```

Non-interactive example (single source):

```bash
node dist/install.js \
  --source imessage \
  --yes \
  --output-dir "$HOME/brain/iMessage" \
  --schedule 05:30 \
  --ac-power-only
```

Multi-source runner — a single launchd job iterates over each source
back-to-back:

```bash
node dist/install.js \
  --enabled-sources imessage,signal,whatsapp,telegram \
  --yes \
  --output-dir "$HOME/brain" \
  --schedule 05:30 \
  --ac-power-only \
  --my-name "Mike Averto"
```

Each source writes to its own subdir under `--output-dir` (e.g.
`<output-dir>/imessage/...`, `<output-dir>/signal/...`, etc.). Sources
with their own state (Telegram session, Signal Keychain entry) must be
set up before the cron job runs unattended.

Doctor mode:

```bash
node dist/install.js --doctor --source imessage
```

Uninstall:

```bash
node dist/install.js --uninstall
```

## Source-specific notes

### iMessage
- direct `chat.db` reads via `sqlite3`
- attributed-body cleanup is heuristic, not perfect

### Signal
- direct SQLCipher reads of the live Signal Desktop DB
- key auto-extracted from macOS Keychain (Sonoma 14.5+ caveat above)
- attachments referenced by count only; bodies skipped for v1

### WhatsApp
- direct ChatStorage.sqlite reads from the macOS Group Container
- requires Full Disk Access; group chats resolved via ZWAGROUPMEMBER
- attachment metadata included; media bodies skipped for v1

### Telegram
- live MTProto via gramjs with persistent StringSession
- per-dialog cursors so daily runs are incremental
- one-time interactive `telegram-login` subcommand for setup

## Development

```bash
npm install
npm run build
npm test
npm run lint
```

## Current limitations

- iMessage remains the deepest native integration
- Telegram, WhatsApp, and Signal support are adapter-first, not exhaustive
- attachment handling is still simplified in shared markdown output
- some stale source-format quirks will still need fixture-driven hardening over time

## License

MIT
