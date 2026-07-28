"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const DEFAULT_SERVER_URL = "http://localhost:8000";

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function readConfig() {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return { serverUrl: typeof parsed.serverUrl === "string" ? parsed.serverUrl : DEFAULT_SERVER_URL };
  } catch {
    return { serverUrl: DEFAULT_SERVER_URL };
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

module.exports = { DEFAULT_SERVER_URL, readConfig, writeConfig };
