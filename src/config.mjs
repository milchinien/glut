import os from "node:os";
import path from "node:path";

const home = os.homedir();

export const config = {
  port: Number(process.env.AI_STATS_PORT || 4317),
  timeZone: process.env.AI_STATS_TIMEZONE || "Europe/Berlin",
  codexSessions: process.env.CODEX_SESSIONS_DIR || path.join(home, ".codex", "sessions"),
  claudeProjects: process.env.CLAUDE_PROJECTS_DIR || path.join(home, ".claude", "projects"),
  claudeStats: process.env.CLAUDE_STATS_FILE || path.join(home, ".claude", "stats-cache.json"),
  claudeCredentials:
    process.env.CLAUDE_CREDENTIALS_FILE || path.join(home, ".claude", ".credentials.json"),
  dataDirectory: path.resolve(process.env.GLUT_DATA_DIR || "data"),
};
