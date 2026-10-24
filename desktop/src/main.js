"use strict";

const path = require("node:path");
const { app, BrowserWindow, Menu, ipcMain, session, shell } = require("electron");
const { readConfig, writeConfig } = require("./config");
const { canNavigateInApp, isSafeExternalUrl } = require("./navigation");
const { serverUrlPatterns, withBearer } = require("./serverAuth");

// This shell doesn't bundle the netlab backend (it needs `netlab`/containerlab
// on the host, same as the web app) — it points at one, same as the web app
// served from the same origin. The window that renders that backend's UI gets
// zero Node/IPC access (see `webPreferences` below); only the local connect
// screen (loaded from our own `file://` bundle) gets the `window.netlabDesktop`
// bridge, and `preload.js` refuses to expose it to anything else.
let mainWindow = null;
let splashWindow = null;

function openExternal(url) {
  if (isSafeExternalUrl(url)) {
    void shell.openExternal(url).catch(() => {});
  }
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    resizable: false,
    movable: true,
    center: true,
    frame: false,
    backgroundColor: "#0b0f19",
    show: false,
    skipTaskbar: true,
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  void splashWindow.loadFile(path.join(__dirname, "splash.html"));

  splashWindow.once("ready-to-show", () => {
    splashWindow.show();
    splashWindow.webContents.executeJavaScript(`window.setVersion(${JSON.stringify(app.getVersion())})`).catch(() => {});
  });
}

function setSplashStatus(text) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.webContents.executeJavaScript(`window.setStatus(${JSON.stringify(text)})`).catch(() => {});
}

function closeSplash() {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.webContents.executeJavaScript("window.dismiss()").catch(() => {});
  const toClose = splashWindow;
  splashWindow = null;
  setTimeout(() => {
    if (!toClose.isDestroyed()) toClose.close();
  }, 320);
}

async function checkHealth(serverUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(new URL("/api/health", serverUrl), { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "netlab-ui",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The backend does real, host-level things (deploys labs, opens shells into
  // nodes) — never let whatever the loaded page does navigate this window or
  // spawn a new one outside the configured server's origin. Anything else
  // (docs links, GitHub, etc.) opens in the user's normal browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!canNavigateInApp(mainWindow.webContents.getURL(), url)) {
      event.preventDefault();
      openExternal(url);
    }
  });

  // The splash stays up until the very first page (server UI or connect
  // screen) has actually painted, so we never flash a blank window.
  mainWindow.webContents.once("did-finish-load", () => {
    closeSplash();
    mainWindow.show();
  });

  void connect();
}

/**
 * Send the API token with every request the page makes to the server (fetch, EventSource and WebSocket alike).
 * Only one listener can be registered per session, so calling this again replaces the previous server's. An empty
 * token removes it, leaving a server behind Basic auth to the browser's own login prompt.
 */
function applyServerAuth(serverUrl, token) {
  const webRequest = session.defaultSession.webRequest;
  if (!token) {
    webRequest.onBeforeSendHeaders(null);
    return;
  }
  webRequest.onBeforeSendHeaders({ urls: serverUrlPatterns(serverUrl) }, (details, callback) => {
    callback({ requestHeaders: withBearer(details.requestHeaders, token) });
  });
}

/** "ok", "unreachable" or "unauthorized". /api/health is open, so the token is checked on a protected route. */
async function probeServer(serverUrl, token) {
  if (!(await checkHealth(serverUrl))) return "unreachable";
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  try {
    const res = await fetch(new URL("/api/environment/netlab", serverUrl), { headers });
    // Without a token a 401 just means Basic auth, which the page's own login prompt handles.
    return res.status === 401 && token ? "unauthorized" : "ok";
  } catch {
    return "unreachable";
  }
}

async function connect() {
  const { serverUrl, token } = readConfig();
  applyServerAuth(serverUrl, token);
  setSplashStatus("Checking server…");
  const reachable = await checkHealth(serverUrl);
  if (reachable) {
    setSplashStatus("Connecting…");
    await mainWindow.loadURL(serverUrl);
  } else {
    setSplashStatus("Opening setup…");
    await mainWindow.loadFile(path.join(__dirname, "connect.html"));
  }
}

ipcMain.handle("netlab-desktop:get-server-url", () => readConfig().serverUrl);

ipcMain.handle("netlab-desktop:check-health", (_event, serverUrl) => checkHealth(serverUrl));

ipcMain.handle("netlab-desktop:get-token", () => readConfig().token);

ipcMain.handle("netlab-desktop:connect", async (_event, serverUrl, token = "") => {
  const result = await probeServer(serverUrl, token);
  if (result !== "ok") return result;
  writeConfig({ serverUrl, token });
  applyServerAuth(serverUrl, token);
  await mainWindow.loadURL(serverUrl);
  return result;
});

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "Server",
      submenu: [
        {
          label: "Change Server…",
          click: () => mainWindow?.loadFile(path.join(__dirname, "connect.html")),
        },
        { label: "Reconnect", click: () => void connect() },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createSplashWindow();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
