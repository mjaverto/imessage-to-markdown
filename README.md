# imessage-to-markdown

Export multiple messaging sources into a shared markdown format.

## Supported sources

- `imessage`
  - reads macOS `chat.db`
- `telegram`
  - reads Telegram Desktop JSON exports
- `whatsapp`
  - reads exported WhatsApp chat `.txt` files
- `signal`
  - reads Signal markdown exports, designed to pair with tools like `signal-export`

## Core idea

Each source has its own adapter, but all adapters normalize into one internal conversation/message model and one shared markdown renderer.

That means the repo is now structured to support multi-platform export without each platform reinventing rendering.

## Install

```bash
git clone https://github.com/mjaverto/imessage-to-markdown.git
cd imessage-to-markdown
npm install
npm run build
```

## Usage

### iMessage

```bash
node dist/cli.js \
  --source imessage \
  --db-path ~/Library/Messages/chat.db \
  --output-dir ~/brain/iMessage
```

### Telegram

```bash
node dist/cli.js \
  --source telegram \
  --export-path ~/Downloads/telegram-export/result.json \
  --output-dir ~/brain/messages
```

### WhatsApp

```bash
node dist/cli.js \
  --source whatsapp \
  --export-path ~/Downloads/_chat.txt \
  --output-dir ~/brain/messages
```

### Signal

```bash
node dist/cli.js \
  --source signal \
  --export-path ~/signal-chats \
  --output-dir ~/brain/messages
```

## Installer status

The included installer is still aimed at the iMessage scheduled-export flow on macOS. The repo now supports multiple adapters, but the installer is not yet a universal multi-source setup wizard.

## Source-specific notes

### Telegram
- best paired with Telegram Desktop export JSON
- current adapter expects JSON exports

### WhatsApp
- current adapter expects exported text chat logs
- deeper backup/database support is still future work

### Signal
- current adapter is designed to ingest markdown-style exports
- practical pairing: `carderne/signal-export`

## Development

```bash
npm install
npm run build
npm test
npm run lint
```

## Current limitations

- iMessage remains the deepest native integration
- Telegram, WhatsApp, and Signal support are adapter-first, not yet exhaustive
- message schema quirks vary by platform export format
- attachments are intentionally simplified in the common markdown renderer

## License

MIT
