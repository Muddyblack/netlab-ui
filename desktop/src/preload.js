"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Only expose the bridge to our own local connect screen (`file://…/connect.html`).
// This preload script runs for *every* page the window loads, including
// whatever the configured netlab backend serves — that page must not get any
// of this, so it gets nothing.
if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("netlabDesktop", {
    getServerUrl: () => ipcRenderer.invoke("netlab-desktop:get-server-url"),
    checkHealth: (serverUrl) => ipcRenderer.invoke("netlab-desktop:check-health", serverUrl),
    connect: (serverUrl) => ipcRenderer.invoke("netlab-desktop:connect", serverUrl),
  });
}
