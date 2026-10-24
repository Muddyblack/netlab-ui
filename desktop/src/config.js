"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");

const DEFAULT_SERVER_URL = "http://localhost:8000";

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

// The API token is a credential for a backend that deploys labs and opens shells, so it is encrypted with the OS
// keychain (safeStorage) when one is available. Otherwise it is stored as plain text in the user-only userData dir.
function encodeToken(token) {
  if (!token) return undefined;
  if (safeStorage.isEncryptionAvailable()) {
    return { encrypted: true, value: safeStorage.encryptString(token).toString("base64") };
  }
  return { encrypted: false, value: token };
}

function decodeToken(stored) {
  if (!stored || typeof stored.value !== "string") return "";
  try {
    return stored.encrypted ? safeStorage.decryptString(Buffer.from(stored.value, "base64")) : stored.value;
  } catch {
    return "";
  }
}

function readConfig() {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      serverUrl: typeof parsed.serverUrl === "string" ? parsed.serverUrl : DEFAULT_SERVER_URL,
      token: decodeToken(parsed.token),
    };
  } catch {
    return { serverUrl: DEFAULT_SERVER_URL, token: "" };
  }
}

function writeConfig({ serverUrl, token }) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify({ serverUrl, token: encodeToken(token) }, null, 2), { mode: 0o600 });
}

module.exports = { DEFAULT_SERVER_URL, readConfig, writeConfig };
