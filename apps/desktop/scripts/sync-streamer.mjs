// Vendor the streamer's reusable, dependency-light modules into
// apps/desktop/src/streamer/ so the Electron app is self-contained
// for packaging (electron-builder only bundles files under the app
// root). The single source of truth stays apps/streamer/src — this
// just copies the pieces the desktop render backend reuses:
//
//   ffmpeg.js     — pure H.264/AAC argv builders (shared verbatim)
//   config.js     — env → runtime config (STREAM_* knobs, profile)
//   autoprofile.js— host detection + encoder pick (honors FFMPEG_PATH)
//   thermal.js    — Pi thermal throttle (no-op off a Pi)
//   logger.js     — pino logger
//   api.js        — the internal HTTP control surface (port 7789)
//
// NOT copied: stream.js (Chromium/puppeteer capture — the desktop
// app renders via Electron instead) or index.js (Docker entrypoint).
//
// Runs on predev + before packaging. Re-copying is cheap and keeps
// the vendored copy from drifting.

import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "..", "streamer", "src");
const outDir = join(here, "..", "src", "streamer");

const FILES = ["ffmpeg.js", "config.js", "autoprofile.js", "thermal.js", "logger.js", "api.js"];

mkdirSync(outDir, { recursive: true });
for (const f of FILES) {
  copyFileSync(join(srcDir, f), join(outDir, f));
  console.log(`[sync-streamer] ${f}`);
}
console.log(`[sync-streamer] vendored ${FILES.length} module(s) → src/streamer/`);
