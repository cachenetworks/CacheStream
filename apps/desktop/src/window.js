"use strict";

/**
 * The visible control-panel window + an optional tray icon.
 * The window simply loads the locally-served Next.js panel.
 */

const { BrowserWindow, Tray, Menu, shell, nativeImage } = require("electron");
const path = require("node:path");

function createPanelWindow(panelUrl) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "CacheStream",
    backgroundColor: "#0a0d18",
    autoHideMenuBar: true,
    webPreferences: {
      // The panel is our own trusted local origin, but keep the
      // renderer locked down anyway — it only needs to display the
      // web UI, not Node.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.loadURL(`${panelUrl}/admin`);

  // Open external links (e.g. Twitch dashboard) in the OS browser,
  // not inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(panelUrl)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  return win;
}

function createTray(getWindow, onQuit) {
  try {
    const iconPath = path.join(__dirname, "..", "build", "icon.png");
    const img = nativeImage.createFromPath(iconPath);
    // An empty image makes Tray throw on some platforms; bail to a
    // window-only experience if we have no usable icon.
    if (img.isEmpty()) return null;

    const tray = new Tray(img);
    tray.setToolTip("CacheStream");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open CacheStream", click: () => { const w = getWindow(); if (w) { w.show(); w.focus(); } } },
      { type: "separator" },
      { label: "Quit", click: () => onQuit() },
    ]));
    tray.on("click", () => { const w = getWindow(); if (w) { w.show(); w.focus(); } });
    return tray;
  } catch {
    return null;
  }
}

module.exports = { createPanelWindow, createTray };
