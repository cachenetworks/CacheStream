"use strict";

/**
 * CacheStream desktop — Electron main process.
 *
 * Boots the whole stack on one machine, no Docker:
 *   1. resolve per-user data dirs + a shared internal token
 *   2. start the AudioRelay (loopback-TCP carrier for music PCM)
 *   3. build the streamer config, start the in-process DesktopStreamer
 *      behind the SAME HTTP control API the web panel already speaks
 *   4. launch the bundled Next.js panel as a child Node process
 *   5. open the panel window
 *
 * The web panel talks to the streamer over 127.0.0.1 exactly as it
 * does to the Docker streamer, so none of its 70+ routes/workers change.
 */

const { app, BrowserWindow } = require("electron");

// Best-effort GPU enablement for the offscreen scene renderer. This
// is the desktop equivalent of the Docker Pi FPS fix — on a Pi the
// GPU is what lifts the compositor past ~3 fps. Harmless on hosts
// that ignore them.
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");

const { resolveDirs, webBundleDir, resolveFfmpeg, freePort } = require("./paths");
const { loadOrCreateToken } = require("./token");
const { startWebServer } = require("./web-server");
const { AudioRelay } = require("./audio-relay");
const { DesktopStreamer } = require("./desktop-streamer");
const { createPanelWindow, createTray } = require("./window");

// Vendored from apps/streamer/src (see scripts/sync-streamer.mjs).
const { buildConfig } = require("./streamer/config");
const { createLogger } = require("./streamer/logger");
const { createApi } = require("./streamer/api");
const { ThermalMonitor } = require("./streamer/thermal");

let state = {
  webChild: null, relay: null, streamer: null, thermal: null,
  api: null, panelWindow: null, tray: null, quitting: false,
};

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const w = state.panelWindow;
    if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
  });
  app.whenReady().then(boot).catch((err) => {
    console.error("[main] boot failed:", err);
    app.quit();
  });
}

async function boot() {
  const dirs = resolveDirs();
  const token = loadOrCreateToken(dirs.tokenFile);
  const ffmpegPath = resolveFfmpeg();

  const [webPort, apiPort, musicInPort, audioOutPort] = await Promise.all([
    freePort(), freePort(), freePort(), freePort(),
  ]);

  // ── Env the vendored streamer config (buildConfig) reads ───────
  process.env.INTERNAL_API_TOKEN = token;
  process.env.STREAMER_PORT = String(apiPort);
  process.env.FFMPEG_PATH = ffmpegPath;
  process.env.DEFAULT_SCENE_URL = `http://127.0.0.1:${webPort}/scene`;
  process.env.NODE_ENV = "production";

  const config = buildConfig({ logger: console });
  const logger = createLogger(config.runtime.logLevel || "info").child({ module: "desktop" });

  logger.info({ webPort, apiPort, musicInPort, audioOutPort, ffmpegPath, dataDir: dirs.data },
    "cachestream desktop starting");

  // ── Audio relay (replaces FIFOs) ───────────────────────────────
  state.relay = new AudioRelay({ inPort: musicInPort, outPort: audioOutPort, logger: logger.child({ module: "audio" }) });
  state.relay.start();

  // ── Streamer + control API ─────────────────────────────────────
  state.streamer = new DesktopStreamer({
    config,
    logger: logger.child({ module: "stream" }),
    ffmpegPath,
    relayOutPort: audioOutPort,
  });
  state.thermal = new ThermalMonitor({ config, streamer: state.streamer, logger: logger.child({ module: "thermal" }) });
  state.thermal.start();
  state.streamer.thermal = state.thermal;

  state.api = createApi({ streamer: state.streamer, config, logger: logger.child({ module: "api" }) });
  await state.api.listen();

  // ── Web panel (Next.js standalone) as a child process ──────────
  const { child, ready } = startWebServer({
    bundleDir: webBundleDir(),
    port: webPort,
    onLog: (line) => logger.info(line),
    env: {
      INTERNAL_API_TOKEN: token,
      STREAMER_URL: `http://127.0.0.1:${apiPort}`,
      PUBLIC_URL: `http://127.0.0.1:${webPort}`,
      DEFAULT_SCENE_URL: `http://127.0.0.1:${webPort}/scene`,
      DATA_DIR: dirs.data,
      MUSIC_LIBRARY_DIR: dirs.music,
      VOD_LIBRARY_DIR: dirs.vods,
      // Cross-platform audio: per-track music FFmpeg → relay.
      AUDIO_TRANSPORT: "tcp",
      MUSIC_TCP_PORT: String(musicInPort),
      FFMPEG_PATH: ffmpegPath,
      TRUST_PROXY: "false",
    },
  });
  state.webChild = child;
  child.on("exit", (code) => {
    logger.warn({ code }, "web server child exited");
    if (!state.quitting) { app.quit(); }
  });

  await ready;
  logger.info({ url: `http://127.0.0.1:${webPort}/admin` }, "panel ready");

  // ── Window + tray ─────────────────────────────────────────────
  state.panelWindow = createPanelWindow(`http://127.0.0.1:${webPort}`);
  state.tray = createTray(() => state.panelWindow, () => app.quit());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && !state.quitting) {
      state.panelWindow = createPanelWindow(`http://127.0.0.1:${webPort}`);
    }
  });
}

app.on("window-all-closed", () => {
  // No tray → quitting closes the app. With a tray we keep running
  // in the background so the stream survives a closed window.
  if (!state.tray) app.quit();
});

app.on("before-quit", async (e) => {
  if (state.quitting) return;
  state.quitting = true;
  e.preventDefault();
  try { state.thermal?.stop(); } catch {}
  try { await state.streamer?.stop(); } catch {}
  try { await state.api?.close(); } catch {}
  try { state.relay?.stop(); } catch {}
  try { state.webChild?.kill(); } catch {}
  app.exit(0);
});
