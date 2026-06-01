"use strict";

/**
 * Filesystem + binary path resolution for the desktop app.
 *
 * Everything mutable (SQLite DB, branding logos, covers, uploaded
 * music + VODs, the internal-API token) lives under Electron's
 * per-user data dir so a packaged, read-only app install still has
 * somewhere to write. In dev it lands under apps/desktop/.userdata.
 */

const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");

function dataRoot() {
  // app.getPath('userData') is the OS-conventional per-app dir
  // (%APPDATA%\CacheStream on Windows, ~/.config/CacheStream on
  // Linux). Created by Electron already.
  const root = app.getPath("userData");
  return root;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** The directory tree the web panel + streamer read/write. */
function resolveDirs() {
  const root = dataRoot();
  return {
    root,
    data:  ensureDir(path.join(root, "data")),        // SQLite + covers + logos
    music: ensureDir(path.join(root, "media", "music")),
    vods:  ensureDir(path.join(root, "media", "vods")),
    tokenFile: path.join(root, ".internal-api-token"),
  };
}

/** Where the staged Next.js standalone bundle lives. */
function webBundleDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "web")
    : path.join(__dirname, "..", "build", "web");
}

/**
 * Resolve a usable ffmpeg binary, in priority order:
 *   1. A per-arch vendored binary under resources/ffmpeg (used for
 *      targets ffmpeg-static doesn't cover — notably win32 arm64).
 *   2. ffmpeg-static's bundled binary (asar-unpacked when packaged).
 *   3. Bare "ffmpeg" on PATH (dev fallback).
 */
function resolveFfmpeg() {
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

  const vendored = app.isPackaged
    ? path.join(process.resourcesPath, "ffmpeg", exe)
    : path.join(__dirname, "..", "build", "ffmpeg",
                `${process.platform}-${process.arch}`, exe);
  if (safeExists(vendored)) return vendored;

  try {
    // ffmpeg-static exports the absolute path to its binary. Inside
    // a packaged app that path points into app.asar; the real file
    // is at app.asar.unpacked thanks to asarUnpack in the builder
    // config, so rewrite the segment.
    let p = require("ffmpeg-static");
    if (p) {
      p = p.replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep)
           .replace("app.asar/", "app.asar.unpacked/");
      if (safeExists(p)) return p;
    }
  } catch { /* not installed in this context */ }

  return "ffmpeg";
}

function safeExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

/** Find a free TCP port on loopback. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

module.exports = { resolveDirs, webBundleDir, resolveFfmpeg, freePort };
