import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = process.env.DATA_DIR || path.join(root, "data");
const settingsPath = path.join(dataDir, "settings.json");

const SECRET_KEYS = new Set([
  "appPassword",
  "r2AccessKeyId",
  "r2SecretAccessKey",
  "sub2apiApiKey",
]);

function nonempty(value) {
  return value !== undefined && value !== null && String(value).length > 0;
}

function envSettings() {
  const accountId = process.env.R2_ACCOUNT_ID || "";
  const explicitEndpoint = (process.env.R2_ENDPOINT || "").trim().replace(/\/+$/, "");
  return {
    appPassword: process.env.APP_PASSWORD || "",
    r2AccountId: accountId,
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    r2Bucket: process.env.R2_BUCKET || "",
    r2Endpoint: explicitEndpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : ""),
    r2ForcePathStyle: /^(1|true|yes)$/i.test(process.env.R2_FORCE_PATH_STYLE || ""),
    sub2apiBaseUrl: (process.env.SUB2API_BASE_URL || "").trim().replace(/\/+$/, ""),
    sub2apiApiKey: process.env.SUB2API_API_KEY || "",
    sub2apiModel: process.env.SUB2API_MODEL || "",
  };
}

function readOverrides() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    return {};
  }
}

export function getSettings() {
  const env = envSettings();
  const file = readOverrides();
  const merged = { ...env };
  for (const [key, value] of Object.entries(file)) {
    if (key === "r2ForcePathStyle" && typeof value === "boolean") {
      merged.r2ForcePathStyle = value;
      continue;
    }
    if (typeof value === "string" && value.length) merged[key] = value;
  }
  if (!nonempty(file.r2Endpoint)) {
    const account = merged.r2AccountId;
    if (account && (!process.env.R2_ENDPOINT || nonempty(file.r2AccountId))) {
      merged.r2Endpoint = `https://${account}.r2.cloudflarestorage.com`;
    }
  }
  return merged;
}

export function r2Ready(settings = getSettings()) {
  return Boolean(settings.r2AccessKeyId && settings.r2SecretAccessKey && settings.r2Bucket && settings.r2Endpoint);
}

export function modelReady(settings = getSettings()) {
  return Boolean(settings.sub2apiBaseUrl && settings.sub2apiApiKey && settings.sub2apiModel);
}

export function maskSecret(value) {
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

export function publicSettings() {
  const settings = getSettings();
  return {
    appPasswordSet: Boolean(settings.appPassword),
    r2AccountId: settings.r2AccountId,
    r2AccessKeyId: maskSecret(settings.r2AccessKeyId),
    r2SecretAccessKey: maskSecret(settings.r2SecretAccessKey),
    r2Bucket: settings.r2Bucket,
    r2Endpoint: settings.r2Endpoint,
    r2ForcePathStyle: settings.r2ForcePathStyle,
    sub2apiBaseUrl: settings.sub2apiBaseUrl,
    sub2apiApiKey: maskSecret(settings.sub2apiApiKey),
    sub2apiModel: settings.sub2apiModel,
    r2Ready: r2Ready(settings),
    modelReady: modelReady(settings),
    hasOverrides: fs.existsSync(settingsPath),
  };
}

function assignFields(target, input, { keepMaskedSecrets }) {
  const next = { ...target };
  for (const [key, raw] of Object.entries(input || {})) {
    if (key === "r2ForcePathStyle") {
      next.r2ForcePathStyle = Boolean(raw);
      continue;
    }
    if (typeof raw !== "string") continue;
    let value = raw.trim();
    if (SECRET_KEYS.has(key) && (value === "" || value.includes("****"))) {
      if (keepMaskedSecrets) continue;
    }
    if (key === "sub2apiBaseUrl" || key === "r2Endpoint") value = value.replace(/\/+$/, "");
    if (!value && keepMaskedSecrets) continue;
    next[key] = value;
  }
  return next;
}

export function previewSettings(input) {
  return assignFields(getSettings(), input, { keepMaskedSecrets: true });
}

export function saveSettings(input) {
  const current = getSettings();
  const file = readOverrides();
  const merged = assignFields(current, input, { keepMaskedSecrets: true });
  const next = { ...file };
  const fields = [
    "appPassword",
    "r2AccountId",
    "r2AccessKeyId",
    "r2SecretAccessKey",
    "r2Bucket",
    "r2Endpoint",
    "sub2apiBaseUrl",
    "sub2apiApiKey",
    "sub2apiModel",
  ];
  for (const key of fields) {
    if (!Object.prototype.hasOwnProperty.call(input || {}, key)) continue;
    const raw = String(input[key] ?? "").trim();
    if (SECRET_KEYS.has(key) && (raw === "" || raw.includes("****"))) continue;
    if (!raw) {
      delete next[key];
      continue;
    }
    next[key] = key === "sub2apiBaseUrl" || key === "r2Endpoint" ? raw.replace(/\/+$/, "") : raw;
  }
  if (Object.prototype.hasOwnProperty.call(input || {}, "r2ForcePathStyle")) {
    next.r2ForcePathStyle = Boolean(input.r2ForcePathStyle);
  }
  if (input?.clearAppPassword) {
    delete next.appPassword;
    merged.appPassword = process.env.APP_PASSWORD || "";
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  return publicSettings();
}

export function clearOverrides() {
  if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath);
  return publicSettings();
}

export function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretPath = path.join(dataDir, "session.secret");
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing) return existing;
  } catch {
    // create one below
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(secretPath, secret, { encoding: "utf8", mode: 0o600 });
  return secret;
}
