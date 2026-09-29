# Glut

Private Codex and Claude Code usage statistics, with one view for several PCs. The dashboard is hosted at `https://miwale.com/usage/` and requires a password. The games page at `/` and portfolio at `/portfolio` are separate.

## What is stored

The collector reads local Codex and Claude Code JSONL histories. It sends derived events (time, model, device, project path, token categories, estimated API value, session ID) and observed Codex limit percentages to the owner's server. Prompt text, tool output and complete source JSONL files are never uploaded. The server archives events in SQLite on a persistent Docker volume. Removed source files do not erase archived statistics. Existing history can only be imported if its source files still exist on a device.

API values use a dated price table and are estimates, not invoices. Provider limit percentages are account-wide observations; the displayed device share of stored tokens is not a measured share of the provider limit.

## Weiteren Windows-PC verbinden

Öffne das Dashboard unter `https://miwale.com/usage/` und wähle **Weiteres Gerät hinzufügen → Einrichtungscode erstellen**. Öffne auf dem neuen Windows-PC PowerShell, führe diese eine Zeile aus und gib anschließend den angezeigten Code ein:

```powershell
$ErrorActionPreference='Stop'; $f=Join-Path $env:TEMP 'glut-install.ps1'; Invoke-WebRequest 'https://raw.githubusercontent.com/milchinien/glut/main/install.ps1' -OutFile $f; powershell.exe -NoProfile -ExecutionPolicy Bypass -File $f
```

Der Code gilt zehn Minuten. Das Skript installiert bei Bedarf Node.js LTS über `winget`, lädt Glut aus diesem Repository, verbindet den PC, liest die vorhandenen lokalen Verläufe ein und richtet eine Windows-Aufgabe für den Abgleich alle fünf Minuten ein. Für die Node.js-Installation kann Windows eine Administratorbestätigung verlangen. Im Dashboard gibt es auch einen kopierbaren Befehl, der den Code bereits enthält.

Das Gerätetoken bleibt in `%LOCALAPPDATA%\Glut\data\sync-state.json`. Ist der PC offline, holt der nächste Durchlauf die Änderungen nach. Um den automatischen Zugriff eines PCs zu entfernen, muss sein Token derzeit auf dem Server in `device-tokens.json` widerrufen werden.

For local-only use, run `start-dashboard.cmd`; the dashboard binds only to `127.0.0.1:4317`. `export-device.cmd` provides a manual JSON export. Local data stays in `data/`, which is ignored by Git.

## Deployment

`Dockerfile` runs the hosted app on port 4318, with `GLUT_DATA_DIR=/data`. Set a strong `GLUT_PASSWORD` outside Git and mount `/data` persistently. The container is designed to join the existing `campsite-net`; the `miwale` nginx container forwards only `/usage/` to it. The site's root and portfolio routing stay as they are. The GHCR image is published from this repository's `main` branch. The `miwale` deployment timer pulls both images.

Back up the `glut-data` Docker volume. It contains the SQLite archive, payment settings and device-token hashes. A password is required before the dashboard is available; without it, the service fails closed with HTTP 503. Pairing codes expire after ten minutes.

## Development

`npm test` checks token normalization, whole-archive sorting, historical persistence, login, pairing and idempotent upload. `npm start` runs the local dashboard. `npm run host` runs the hosted variant; for local development set `GLUT_PASSWORD`, `GLUT_PORT` and `GLUT_DATA_DIR` first.
