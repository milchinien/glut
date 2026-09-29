import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "./config.mjs";

const settingsPath = path.join(config.dataDirectory, "settings.json");

function defaults() {
  return {
    device: { id: crypto.randomUUID(), name: os.hostname() },
    subscriptions: {
      codex: { monthlyUsd: 0 },
      claude: { monthlyUsd: 0 },
    },
    payments: {},
  };
}

export function getSettings() {
  fs.mkdirSync(config.dataDirectory, { recursive: true });
  let current;
  try {
    current = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    current = defaults();
    fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2));
  }
  const base = defaults();
  return {
    ...base,
    ...current,
    device: { ...base.device, ...(current.device || {}) },
    subscriptions: {
      codex: { ...base.subscriptions.codex, ...(current.subscriptions?.codex || {}) },
      claude: { ...base.subscriptions.claude, ...(current.subscriptions?.claude || {}) },
    },
  };
}

export function saveSettings(input) {
  const current = getSettings();
  const cleanNumber = (value) => Math.min(10_000, Math.max(0, Number(value) || 0));
  const cleanName = String(input.device?.name || current.device.name).trim().slice(0, 80);
  const next = {
    ...current,
    device: { ...current.device, name: cleanName || os.hostname() },
    payments: {...current.payments},
    subscriptions: {
      codex: { monthlyUsd: cleanNumber(input.subscriptions?.codex?.monthlyUsd) },
      claude: { monthlyUsd: cleanNumber(input.subscriptions?.claude?.monthlyUsd) },
    },
  };
  if(input.payment && /^\d{4}-\d{2}$/.test(input.payment.month)) {
    next.payments[input.payment.month]={
      codex:input.payment.codex===''?null:cleanNumber(input.payment.codex),
      claude:input.payment.claude===''?null:cleanNumber(input.payment.claude),
    };
  }
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2));
  return next;
}
