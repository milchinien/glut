# Glut

Private Codex and Claude Code usage statistics, with one view for several PCs. The dashboard is hosted at `https://miwale.com/usage/` and requires a password. The games page at `/` and portfolio at `/portfolio` are separate.

## What is stored

The collector reads local Codex and Claude Code JSONL histories. It sends derived events (time, model, device, project path, token categories, estimated API value, session ID) and observed Codex limit percentages to the owner's server. Prompt text, tool output and complete source JSONL files are never uploaded. The server archives events in SQLite on a persistent Docker volume. Removed source files do not erase archived statistics. Existing history can only be imported if its source files still exist on a device.

API values use a dated price table and are estimates, not invoices. Provider limit percentages are account-wide observations; the displayed device share of stored tokens is not a measured share of the provider limit.

## Another Windows PC

1. Open the dashboard and choose **Weiteres Gerät hinzufügen → Einrichtungscode erstellen**.
2. On that PC, install Node.js 22.13 or newer if needed.
3. Open PowerShell and run the displayed command within ten minutes.

The installer downloads this repository, pairs the PC with a one-time code, imports its existing local history, and registers a per-user Windows Scheduled Task for changes every five minutes. No GitHub repository or manual export is needed. The long-lived device token stays in `%LOCALAPPDATA%\Glut\data\sync-state.json` and is not displayed in the browser. If the PC is offline, the next task run catches up. To remove a PC's automatic access, its server token must currently be revoked in `device-tokens.json` on the server.

For local-only use, run `start-dashboard.cmd`; the dashboard binds only to `127.0.0.1:4317`. `export-device.cmd` provides a manual JSON export. Local data stays in `data/`, which is ignored by Git.

## Deployment

`Dockerfile` runs the hosted app on port 4318, with `GLUT_DATA_DIR=/data`. Set a strong `GLUT_PASSWORD` outside Git and mount `/data` persistently. The container is designed to join the existing `campsite-net`; the `miwale` nginx container forwards only `/usage/` to it. The site's root and portfolio routing stay as they are. The GHCR image is published from this repository's `main` branch. The `miwale` deployment timer pulls both images.

Back up the `glut-data` Docker volume. It contains the SQLite archive, payment settings and device-token hashes. A password is required before the dashboard is available; without it, the service fails closed with HTTP 503. Pairing codes expire after ten minutes.

## Development

`npm test` checks token normalization, whole-archive sorting, historical persistence, login, pairing and idempotent upload. `npm start` runs the local dashboard. `npm run host` runs the hosted variant; for local development set `GLUT_PASSWORD`, `GLUT_PORT` and `GLUT_DATA_DIR` first.
