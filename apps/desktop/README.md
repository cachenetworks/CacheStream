# CacheStream Desktop

CacheStream as a **native desktop app** — the full control panel plus
the headless streaming pipeline, with **no Docker, no Node, no Chromium,
and no FFmpeg to install**. One installer, double-click, log in to
Twitch, hit **Start**.

Targets: **Linux** (x64 + arm64, incl. Raspberry Pi OS 64-bit) and
**Windows** (x64 + arm64), as AppImage / `.deb` / NSIS installer /
portable `.exe`.

## How it works

It's an [Electron](https://www.electronjs.org/) app that reuses the
existing CacheStream pieces instead of forking them:

```
Electron main process
 ├─ AudioRelay            loopback-TCP carrier for music PCM (replaces
 │                        the Linux FIFOs — works on Windows too)
 ├─ DesktopStreamer       offscreen, GPU-accelerated BrowserWindow renders
 │   │                    /scene/* at a guaranteed frame rate …
 │   └─ 'paint' → JPEG  → bundled FFmpeg → Twitch RTMP
 ├─ internal control API  the SAME http://127.0.0.1 API the panel speaks
 │                        (vendored from apps/streamer/src/api.js)
 └─ Next.js panel         the unmodified apps/web standalone server, run
                          as a child process via utilityProcess.fork
```

Because the panel talks to the streamer purely over `127.0.0.1`, every
panel feature (chat, alerts, scenes, overlays, music, VODs, games,
branding, scheduler, RTMP ingest) works exactly as in the Docker build.

Rendering scenes through Electron's offscreen GPU window with a fixed
`setFrameRate` is also what makes the desktop app immune to the Pi's
"~3 fps software-compositor" problem — no flags needed.

## Develop

```bash
cd apps/desktop
npm install
npm run build-web      # build the Next.js panel once → ./build/web
npm run dev            # launches Electron against ./build/web
```

`npm run dev` runs `sync-streamer` first, which copies the reusable
streamer modules (`ffmpeg/config/autoprofile/thermal/logger/api`) from
`apps/streamer/src` into `src/streamer/`. That directory is generated —
the single source of truth is `apps/streamer/src`.

Re-run `npm run build-web` whenever you change the web app.

## Package installers

```bash
npm run dist            # current platform/arch
npm run dist:linux      # AppImage + deb, x64 + arm64
npm run dist:win        # NSIS + portable, x64 + arm64
```

Output lands in `dist/`. Cross-arch native builds (better-sqlite3 +
ffmpeg) are best produced on a native runner of the target arch — see
[`.github/workflows/desktop.yml`](../../.github/workflows/desktop.yml),
which builds all four targets on matching GitHub runners and attaches
the installers to the tagged release.

## Bundled binaries

- **Chromium** — Electron's own (rendering + the panel window).
- **FFmpeg** — [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static)
  for linux x64/arm64 + win x64. Windows-arm64 isn't covered by
  ffmpeg-static, so CI vendors a [BtbN](https://github.com/BtbN/FFmpeg-Builds)
  win-arm64 build into `build/ffmpeg/win32-arm64/` and the app prefers
  that. `resolveFfmpeg()` falls back to a `ffmpeg` on `PATH` in dev.
- **SQLite** — `better-sqlite3` from the web bundle, rebuilt against
  Electron's ABI during `build-web`.

## Data location

Everything mutable lives under the per-user data dir
(`app.getPath('userData')`):

- Windows: `%APPDATA%\CacheStream\`
- Linux: `~/.config/CacheStream/`

…containing `data/` (SQLite DB, covers, logos), `media/music`,
`media/vods`, and `.internal-api-token`.
