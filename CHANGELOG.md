# Changelog

## 1.14.2

Desktop Linux ARM64 packaging and AMD64 Docker streaming fixes.

### Desktop CI

- Fixed the Linux ARM64 desktop workflow failing while building `.deb`
  installers with `Exec format error`.
- The ARM64 runner now installs and uses a native Ruby `fpm` instead
  of electron-builder's bundled x86-only `fpm` binary.
- Electron Builder target config now lets each matrix job build only
  its requested architecture, preventing the ARM64 job from also
  trying to package x64 Linux artifacts.

### Docker streamer

- AMD64 Docker servers now default to software `libx264` unless a
  usable NVIDIA or Intel render device is visible inside the
  container, preventing reconnect loops caused by FFmpeg selecting
  unavailable hardware encoders.
- Hardware encoder fallback detection now also catches CUDA, NVENC,
  QSV, and Media SDK startup failures, so the streamer can recover to
  software encoding instead of repeatedly failing to start.

### Versions

- Bumped the web, streamer, and desktop package versions to `1.14.2`.

## 1.14.1

AMD64 Docker streamer stability fix.

### Docker streamer

- Fixed the AMD64 `cachestream-streamer` container failing to start
  Chromium with `chrome_crashpad_handler: --database is required`.
- The streamer image now gives Chromium a writable non-root
  `HOME`, XDG config/cache directories, and a dedicated runtime
  directory under `/tmp`.
- Chromium now launches with an isolated temporary profile plus an
  explicit crash dump directory, then cleans that profile up during
  teardown/reconnect.
- Crash reporting is disabled for the headless capture browser, which
  avoids crashpad startup failures while keeping the existing
  Puppeteer -> FFmpeg streaming pipeline unchanged.

### Release notes

This is primarily for x64/AMD64 Docker deployments using the GHCR or
local Docker images. ARM64/Pi-specific compose behavior is unchanged.

## 1.14.0

Native **desktop app** — CacheStream now runs without Docker on
Linux (x64 + arm64, incl. Raspberry Pi) and Windows (x64 + arm64).

### What it is

A new `apps/desktop/` Electron app that bundles Chromium, a static
FFmpeg, the panel, and the streamer into a single installer
(AppImage / `.deb` / NSIS / portable `.exe`). Double-click, log in
to Twitch, hit Start — nothing else to install.

It reuses the existing pieces rather than forking them:

- The unmodified Next.js panel (`apps/web`) runs as a child process
  via Electron's `utilityProcess.fork`.
- A new `DesktopStreamer` renders `/scene/*` through an **offscreen,
  GPU-accelerated** `BrowserWindow` at a fixed `setFrameRate`, pipes
  JPEG frames to the bundled FFmpeg, and exposes the **same**
  `127.0.0.1` control API the panel already speaks (the streamer's
  `api.js` is shared verbatim). Because Electron renders on the GPU,
  the desktop app sidesteps the Pi software-compositor FPS problem
  with no flags.
- The H.264/AAC argv builders were extracted to
  `apps/streamer/src/ffmpeg.js` and are shared by both backends.

### Cross-platform audio

The Linux build pipes music through named FIFOs (`mkfifo`), which
don't exist on Windows. A new `AUDIO_TRANSPORT=fifo|tcp` switch
(default `fifo` — Docker is byte-identical) lets the desktop app use
`tcp` instead: the per-track music FFmpeg connects to a small
loopback-TCP relay that supplies the always-on silent carrier, so
the broadcast's audio input never drops between tracks. `autoprofile`
and the music engine now also honour `FFMPEG_PATH` so the bundled
binary is used when there's no `ffmpeg` on `PATH`.

### CI

`.github/workflows/desktop.yml` builds all four targets on matching
native runners and attaches the installers to the tagged release.

## 1.13.9

GPU rasterisation for the headless Chromium scene renderer —
fixes the "scenes are stuck at ~3 fps on a Raspberry Pi" problem.

### Why scenes were choppy

`Page.startScreencast` is paint-driven: Chromium only hands us a
frame when its compositor produces one. The streamer hard-forced
`--disable-gpu` **and** `--disable-software-rasterizer`, pinning
all compositing to the CPU SwiftShader path. On a Pi, software-
compositing the animated scenes (gradients, `backdrop-filter`
blur, big `box-shadow`) at 720p saturates the CPU and the page
only repaints ~3 times a second. FFmpeg dutifully padded that to
30 fps CFR, so the broadcast *looked* like a 3-fps slideshow even
though Twitch was receiving 30 fps.

### `STREAM_CHROMIUM_GPU=auto|on|off`

New knob (default `auto`). `auto` enables GPU rasterisation when
the host is a Pi or exposes a `/dev/dri/renderD128` render node;
`on`/`off` force it. When on, the launcher drops the two
`--disable-*` flags and adds `--enable-gpu-rasterization`,
`--ignore-gpu-blocklist`, `--enable-zero-copy`, `--use-gl=egl`,
`--disable-frame-rate-limit`. GPU init failure falls back to
software on its own, so the worst case is the old behaviour.

This is unrelated to the `h264_v4l2m2m` hardware *encoder* (a
separate block), so it also speeds up the **Pi 5**, which has a
GPU for rendering but no fixed-function H.264 encoder.

### Plumbing

- The streamer image now ships the Mesa DRI/EGL userspace drivers
  (`libegl1`, `libgles2`, `libgl1-mesa-dri`, `mesa-va-drivers`)
  so in-container Chromium can actually reach the GPU.
- `docker-compose.pi.yml` now maps `/dev/dri` and adds the
  `render` supplementary group alongside the existing v4l2
  encoder devices. Pi 5 guidance added for a `/dev/dri`-only
  overlay.
- The streamer's boot log reports the chosen GPU mode.

## 1.13.8

Three log-noise fixes — `docker compose logs` was unreadable on
a healthy idle deployment because of unnecessary 404s and
ffmpeg pacing warnings.

### `/api/ingest/status` no longer probes the .m3u8 unnecessarily

The endpoint had two independent liveness checks: `/stat` XML
(authoritative) and a HEAD on the `.m3u8` (fallback for older
nginx-rtmp builds). The fallback fired ANY time `/stat` said
the stream wasn't live — including the normal "no publisher
yet" case — generating a 404 per panel poll per key. For three
configured keys polled every second that was ~180 entries per
minute in the ingest error log.

The HEAD probe now only runs when `/stat` itself was
unreachable. If `/stat` returns 200 with no stream, we trust it.

### nginx `log_not_found off;` on the HLS location

Belt-and-braces for any remaining 404s (mods or dev poking the
URL directly). The HTTP response is still 404; only the
error-log entry is suppressed.

### Streamer FFmpeg `-framerate` hint on the MJPEG input

Without an explicit input framerate, the image2pipe demuxer
defaulted to 25 fps internally. Combined with
`-use_wallclock_as_timestamps 1` + Chromium's ~30 fps
screencast output, PTS sequences went non-monotonic during
brief bursts and FFmpeg logged "Past duration too large" +
"dropping frame N from stream 0" on every glitch. Telling the
demuxer the expected rate upfront via `-framerate <fps>`
aligns timestamps and silences the spam.

The actual broadcast quality is unchanged — these were never
visible to viewers, just panel-operator-noise.

## 1.13.7

Proper secret-handling for RTMP stream keys in the panel.

Stream keys are credentials — anyone who has one can publish to
your CacheStream broadcast. Previously they were always rendered
in plain text in the Sources tab, which is risky when:

  - you screen-share the panel for a tutorial,
  - you stream the panel itself as a scene,
  - you have a moderator looking over your shoulder.

### Masked by default, reveal on demand

  - Stream keys now display as `••••••••••••<last4>` everywhere
    in the multi-key card. The last 4 chars stay visible as a
    recognisability hint so two masked keys can be told apart
    at a glance.
  - **Reveal** button exposes the full key briefly with a
    visible countdown; auto-hides after 10 seconds so a
    forgotten reveal can't sit on-screen.
  - **Copy** puts the raw value on the clipboard without ever
    rendering it in the DOM. This is the safe default action.

### New-key banner

When a key is created (Add) or rotated (Rotate), the new value
is shown once in a prominent banner above the list with a Copy
button. Once the banner is dismissed the key reverts to masked
display like every other entry — still retrievable via Reveal,
but no longer emphasised.

### Rotate ("Regenerate") flow

New per-row **Rotate** button calls
`POST /api/ingest/keys/<key>/regenerate`. The server mints a
fresh 24-char hex value, preserves the row's label, and
invalidates the old value. The UI shows the new key in the
banner so the operator can paste it into their encoder
immediately.

The default key (kv `ingest_stream_key`, typically `cache`)
can be rotated this way too — the endpoint updates the kv slot
in place.

### Migration

No data changes. Existing keys keep working with their existing
values; they're just displayed masked from now on. After
upgrading, you can rotate any key you suspect of having leaked
without losing the corresponding scene preset (the preset URL
still references the old key — you'll need to recreate the
scene or edit its URL in the Scenes tab).

## 1.13.6

RTMP ingest overhaul. Reports of "OBS connected but 0 frames at
our server" traced back to the ingest sidecar.

### Root cause: abandoned upstream image

The ingest service was running `tiangolo/nginx-rtmp:latest`, an
image that hasn't been touched since 2018. Its `nginx-rtmp-module`
build pre-dates a lot of changes in modern encoders — OBS 30+'s
Enhanced RTMP signalling, current Twitch / YouTube ingest
behaviours, etc. Newer OBS versions could open the TCP connection
+ send the publish handshake without nginx-rtmp ever forwarding
the data into the HLS pipeline. Result: OBS shows green, panel
shows "idle", zero frames.

### Fix: build our own ingest image

`apps/ingest/Dockerfile` is a small two-stage Debian-slim build:
- Stage 1: `apt-get build-essential`, fetch nginx 1.27.4 +
  `nginx-rtmp-module` 1.2.2 (latest stable), compile +
  `make install`.
- Stage 2: copy the binary + minimal runtime libs into a clean
  image with `tini` as PID 1. ~50 MB.

Multi-arch (amd64 + arm64) builds added to `.github/workflows/release.yml`
alongside the existing `cachestream-web` + `cachestream-streamer`
images. Pi 5 + amd64 hosts both get a native build via QEMU.

### Diagnostics + UX wins

- nginx-rtmp **/stat XML feed** exposed on the internal HTTP port.
  The `/api/ingest/status` endpoint now parses this for real
  inbound bitrate, publisher IP, video codec + resolution.
  "Live: true" now means a publisher is actually pushing, not
  just that there's a stale HLS playlist file on disk.
- **nginx error_log + access_log → stderr/stdout** so
  `docker compose logs ingest` shows every publish/play event +
  the client IP. Was previously silent.
- **`pushUrl` returns a real URL**: derives from PUBLIC_URL's
  hostname (or `RTMP_PUBLIC_HOST` env override), no more
  `rtmp://<host>:1935/live` literal placeholder text the
  operator had to mentally substitute.
- **Multi-key card** in the Sources tab now surfaces the live
  bitrate + publisher IP per key, plus a prominent Server URL
  copy box at the top.
- **`hls_continuous on`** prevents brief audio dropouts during
  scene cuts from stalling the HLS player.

### New env

- `RTMP_PUBLIC_HOST` (optional): explicit hostname/IP the panel
  shows operators for the OBS push URL. Set this when the panel
  is behind a tunneled https domain but RTMP must reach the host
  on a different address (LAN IP, separate server, etc.).

### Migration

`docker compose up -d --build` will rebuild the ingest container
from the new Dockerfile. Existing `cachestream-ingest-hls`
volume is reused as-is. Once `cachestream-ingest:latest` is
published to GHCR (next release build), `docker compose pull`
will work too.

If a stream was already configured, OBS settings don't change
— same server URL, same stream key.

## 1.13.5

Memory leak audit + fixes. Client reports of the streamer
climbing to 70-80% memory over long streams traced back to
five distinct issues. The big one is fixed; the rest are
defensive hardening + observability so future leaks of this
class are visible BEFORE the host OOM-kills the container.

### #1 (CRITICAL) — Screencast frame buffer overrun

The screencast handler used `stdin.write(buf)` unconditionally,
ignoring the return value. When FFmpeg stalled (HW encoder
hiccup, RTMP push backpressure, disk IO spike), Node buffered
the unwritten frames INTERNALLY without bound. The OS pipe
holds only ~64 KB; anything beyond that lived in Node's
`Writable._writableState.buffered` chain forever.

At 30 fps × ~100 KB JPEG ≈ 3 MB/s, even a 30-second stall
queues ~90 MB. Over a 10-hour stream with intermittent stalls,
this single mechanism could push the streamer container to
70-80% memory on a Pi 5 — exactly the reported symptom.

Fix: before writing, check `stdin.writableLength`. If more than
~256 KB (about 3 frames' worth) is already buffered, the frame
is dropped entirely. A live stream values fresh frames over a
queue of stale ones, and Twitch's encoder fills brief gaps by
repeating the previous frame. Dropped frames are now counted
and reported in `/status` as `framesDropped`.

### #2 — Silence-filler stdio leakage

Both web-side silence fillers (`SILENCE_FIFO` + `MUSIC_FIFO`
writers) spawned FFmpeg with `stdio: ["ignore", "ignore", "pipe"]`
where stderr was piped but **never read**. Every byte FFmpeg
wrote sat in Node's pipe buffer forever. At `loglevel=error`
this is rare but not zero — and across a multi-week container
uptime, small accumulations add up.

Fix: `stdio: ["ignore", "ignore", "ignore"]`. The OS now
discards stderr at the source, nothing to accumulate.

### #3 — Main + VOD FFmpeg unread stdout

The streamer's main FFmpeg and the VOD-playback FFmpeg both
spawned with `stdout: "pipe"` — neither had a consumer. FFmpeg
writes RTMP to the output URL, not stdout, so the leak rate
was tiny, but the buffer was unbounded and there's no reason
to keep it open.

Fix: `stdout: "ignore"` on both. The music writer (track
playback) gets the same treatment.

### #4 — Memory-pressure recycle

A new watchdog check: if the streamer process RSS exceeds
`STREAM_MEMORY_RECYCLE_LIMIT_MB` (default 1500 MB), force an
immediate pipeline recycle. This is independent of the
existing periodic 6 h recycle, so a fast leak gets caught long
before the periodic timer fires.

Default 1500 MB is comfortable for a Pi 5 (8 GB) running the
streamer container with its typical 800-1200 MB working set.
Set the env var to `0` to disable.

### #5 — Observability

`GET /status` now reports:

  - `framesDropped` — running total of dropped frames (#1 above)
  - `memory` — RSS / heap / external in MB
  - `stdinBufferedKB` — current FFmpeg stdin backlog in KB

So you can see backpressure building up + memory growth from
the panel without SSHing in.

### Recommended action

Hit Update on the panel. If your stream is currently
misbehaving, the panel's Status tab will start showing the new
`framesDropped` + `memory` fields, so you can confirm the leak
is contained over the next few hours.

## 1.13.4

Fixes the "chat games keep breaking" problem.

### Root cause: EventEmitter stops dispatching on throw

Node's EventEmitter has an awkward behaviour where a synchronous
listener that throws stops the dispatch right there — later
listeners on the same `emit()` never run, and the throw
propagates up to the caller. With chat fanning out to multiple
subscribers (pet game, datacenter game, panel SSE, AutoMod,
command engine), any one of them having a bad message — a
malformed payload, a stray DB lock, a missing row — would
silently drop the message for everyone else.

The symptom was games that "worked sometimes" but would stop
responding to chat after a while. The fix is at the bus layer:

  - `lib/bus.ts` now wraps every `subscribe()`'d handler in a
    try/catch. A handler throw is logged (once per topic per
    minute, throttled to avoid spam) but doesn't propagate to
    `emit()`. Other subscribers always get their turn.
  - The unsubscribe path uses a `WeakMap` to find the wrapped
    handler back from the original reference, so existing
    callers can still rely on `subscribe()` returning a working
    `unsub` closure.

### Belt-and-braces in the game handlers

  - `pet._onChat` and `datacenter._onChat` now have a
    defensive top-level try/catch each. Even with the bus-layer
    wrap as the primary line of defence, a failing DB write
    inside a game shouldn't leave the game state half-written —
    a thrown DB error now logs cleanly instead of corrupting
    the in-memory `state()` accumulator.
  - Small `msg.name || msg.login || "viewer"` fallback in
    pet mutation log entries — previously a notification-style
    message with no name+login would render as
    `"undefined: feed"` in the feed log.

## 1.13.3

Long-stream stability — fixes the issue where the streamer
would silently die after 10+ hours and not reconnect.

### Frame-flow watchdog

A new module-level interval polls every 5 s; if the streamer is
in `state === "running"` but the screencast hasn't delivered a
frame to FFmpeg in `STREAM_WATCHDOG_TIMEOUT_SECONDS` (default
30 s), it forces a reconnect.

Catches the silent-death failure mode where nothing crashes
outright but the Chromium → FFmpeg pipe goes quiet: TCP idle
drop on the RTMP push, dead CDP screencast session after a v8
GC pause, page-renderer hang, etc. Set the env to `0` to disable.

### Periodic Chromium recycle

Every `STREAM_BROWSER_RECYCLE_HOURS` (default 6 h) of healthy
uptime, the streamer proactively tears down + restarts the
pipeline. Defends against gradual Chromium memory bloat and
state accumulation that, over a multi-hour stream, has been
observed to silently break the broadcast.

Six hours is conservative — most streams are over before it
fires. Bump to a higher value if you do longer single sessions.
Set to `0` to disable.

### Bounded teardown

`_teardown()` is now wrapped in a `Promise.race` against a
`STREAM_TEARDOWN_TIMEOUT_SECONDS` (default 10 s) deadline. If
`browser.close()` or any other step hangs (Chromium with a
leaked tab after 10 h occasionally does), we proceed anyway
and `SIGKILL` the leftover processes. Previously a wedged
close could hang the reconnect cycle indefinitely.

Also, after the timeout fires, the streamer aggressively
`SIGKILL`s the underlying Chromium PID via
`browser.process().kill('SIGKILL')` so file descriptors and
sockets actually get released — `browser.close()` alone leaks
them when the process is stuck.

### Re-entrant reconnect race fix

The previous `_scheduleReconnect()` guard was
`if (this.restartTimer) return`. Inside the timer body,
`this.restartTimer = null` was cleared BEFORE `_teardown()`'s
await started — leaving a window where a parallel event
(FFmpeg exit, browser disconnect, watchdog) could fire
`_scheduleReconnect` again and start a SECOND reconnect cycle
concurrently. Over a 10 h stream those races compounded into
a wedged streamer.

Now we hold a `this.reconnecting` flag for the FULL teardown +
`_runOnce()` duration, so parallel triggers bail cleanly and
the in-flight cycle completes (or fails) before another can
start.

### New env vars

  STREAM_WATCHDOG_TIMEOUT_SECONDS=30
  STREAM_BROWSER_RECYCLE_HOURS=6
  STREAM_TEARDOWN_TIMEOUT_SECONDS=10

All optional; sensible defaults kick in if unset.

## 1.13.2

Latency & performance pass.

Bug fixes:
- streamer: `setScene()` was using `waitUntil: networkidle2` instead
  of `domcontentloaded`, causing every panel-triggered scene switch
  to stall 500 ms – 30 s when SSE connections (chat, alerts, games)
  were open. Matches the fix already applied to `_openScene()` in
  v1.13.1.

Performance improvements:
- streamer: reduce FFmpeg `thread_queue_size` from 1024 → 32 on all
  three inputs (video stdin, silence FIFO, music FIFO). A 1024-slot
  queue allows up to 34 seconds of buffered frames; 32 keeps in-
  flight depth under ~1 s, appropriate for a live push pipeline.
- streamer: reconnect delay is now exponential backoff (starts at
  1 s, doubles each attempt, caps at `RECONNECT_DELAY_SECONDS`)
  rather than a fixed interval. Resets to 1 s on a clean start.
- streamer: VOD FFmpeg no longer applies an unconditional `scale=`
  filter. Removed the `sws_scale` pass that ran on every frame
  even when source dimensions already matched the output spec.
- eventsub: all 8 EventSub subscription POSTs sent in parallel via
  `Promise.allSettled()` instead of sequentially. Reduces setup
  time from ~1.4 s (8 × serial round-trip) to ~200 ms (one round-
  trip).
- eventsub: initial reconnect backoff reduced from 1000 ms → 250 ms.
  Faster recovery from transient Twitch edge drops.
- streamer-client: RPC timeout is now differentiated per endpoint.
  `/start` and `/restart` keep a 20 s budget (Chromium launch);
  others (`/status`, `/stop`, `/scene`, `/overlays`, `/vod/*`,
  `/ingest`) use 5 s so a hung streamer fails fast.
- db: SQLite now sets `synchronous=NORMAL` (safe in WAL mode,
  removes per-commit fsync), `mmap_size=256MB`, `temp_store=MEMORY`,
  `cache_size=20MB`.
- db: `kvGet/kvSet/kvDelete` cache their prepared statements at
  module level — previously `prepare()` was called on every
  invocation, re-parsing the SQL each time.

## 1.13.1

Streamer performance pass — incorporates the per-frame CDP ack
fix from the v1.13.0 follow-up PR plus a batch of further wins.

### CDP screencast (PR #2, already on main)

Page.screencastFrameAck is now fire-and-forget instead of
awaited. Chromium holds the next frame until it sees the ack;
the await was serialising every frame through one full IPC
round-trip (~5–15 ms on a local socket) and was the single
biggest source of streaming lag. Fixed in commit d4c2150.

### FFmpeg filter graph (new in v1.13.1)

The previous pipeline ran `fps=N, scale=WxH, format=yuv420p` on
EVERY frame even when none of them did meaningful work:

  - `fps=N` is a no-op when Chromium already emits at N fps,
  - `scale=WxH` is a no-op when the viewport matches output,
  - `format=yuv420p` is redundant with `-pix_fmt yuv420p` on the
    encoder (which converts once at encoder entry vs per-frame).

In the default config all three filters elide. The new
buildVideoFilters helper only adds `fps=` when running in
capture-every-nth-frame low-CPU mode. When no filters are
needed, the pipeline maps `[0:v]` straight to the encoder and
skips the filter-graph copy entirely.

### Removed redundant amix input

The streamer's FFmpeg used to mix THREE audio sources: silence
FIFO, music FIFO, and an in-FFmpeg `anullsrc` "safety net". The
two FIFO writers (web-side silence fillers) are guaranteed to
exist by the time the streamer connects — they spawn in
MusicEngine's constructor at boot, well before `/api/stream/start`
ever fires. The third input was idle decoder work. Dropped it;
amix is now `inputs=2` instead of `inputs=3`.

### Chromium flag cleanup

Added flags that disable background work Chromium normally does
for an interactive browser but never helps a headless streamer:
`--disable-features=Translate,BackForwardCache,PaintHolding,...`
plus `--no-first-run`, `--disable-sync`, `--disable-extensions`,
`--disable-component-update`, `--disable-domain-reliability`,
and several others. Mostly memory + startup-time wins; nothing
hot-path.

### Scene-load wait policy

`page.goto(..., { waitUntil: "networkidle2" })` →
`{ waitUntil: "domcontentloaded" }`. The overlays (chat,
alerts, etc.) open long-lived SSE connections that prevented
network-idle from ever firing on scenes with three or more
overlays — we'd stall for the full 30 s timeout. DOMContentLoaded
fires when the HTML parser is done; the first frame paints
~500 ms sooner on scene switches.

### Per-frame screencast handler micro-wins

Cached `this.client` and `this.ffmpeg.stdin` into local consts
inside the screencast frame callback. Minor — a few µs per
frame — but at 30 fps every µs counts.

## 1.13.0

Multi-broadcaster + mobile control panel. Final feature in the
original v1.x roadmap.

### Multi-broadcaster (moderator invites)

The owner can now invite trusted users (mods) to drive the
panel without giving up the broadcaster's Twitch account.

- **New Staff tab** (owner-only) — mint single-use invite codes
  with optional expiry (1h / 24h / 7d / 30d / never), copy the
  URL, share it with the mod. Active moderators list + revoke
  any time.
- **`/login/invite?code=<code>`** lands the mod, sets a signed
  cookie, bounces them through Twitch OAuth. The callback
  atomically consumes the code + adds them to `moderators`.
- **Role badge in the panel header** — `OWNER` (cyan) or `MOD`
  (amber). Mods also see "for <broadcaster>" so they remember
  which channel they're driving.
- **Owner-only tabs hidden from mods** — Branding + Staff. All
  other tabs (Status, Studio, Scenes, Sources, Stream Info,
  Chat, Commands, Alerts, Music, VODs, Games) work for both.

### New permission tier

  `requireOwner()`  — broadcaster only (identity/billing/staff)
  `requireStaff()`  — owner OR mod (everyday panel driving)

`api-helpers.ts` now exports `staffRoute()` alongside
`ownerRoute()`. 51 of the 67 existing API routes migrated to
`staffRoute`; 14 stayed owner-only (branding, stream-key
rotation, invite management, host updater, upload quotas).

The broadcaster's tokens still drive Helix calls regardless of
which mod triggered the action — mods authenticate as themselves
but the channel identity remains the owner. Mods' own tokens are
discarded after session creation; they're not used for anything
downstream.

### New schema

  moderators       — twitch_user_id, login, display_name,
                     added_at, added_by_login, scopes_json
  staff_invites    — code, label, created_*, expires_at,
                     status (pending/consumed/revoked),
                     consumed_*

Migration `v5` is idempotent and additive — no data changes for
existing single-owner deployments.

### Mobile control panel

The admin shell now adapts to phone-sized screens:

- **Drawer nav** under 700px — horizontal tab bar collapses to a
  hamburger menu, opens into a vertical list. Tap a tab → drawer
  closes + tab activates.
- **Stacked layouts** — header wraps gracefully; multi-column
  cards collapse to single column; metric grids go 1→2 columns
  under 700px.
- **Larger tap targets** — buttons + inputs get 38px minimum
  height; inputs get 16px font size to prevent iOS zoom-on-focus.
- **Tighter breakpoints**: 900px (tablet), 700px (phone),
  400px (small phone — drops the role-badge text spacing,
  shrinks brand text).

The desktop layout is unchanged.

### Migration

`docker compose up -d --build` (or hit Update on the panel).
Existing single-owner deployments work exactly as before; the
new tables stay empty until the owner mints their first invite.

## 1.12.0

Custom-command live-stat variables.

Custom commands now have five new response template tokens that
resolve against the current broadcast state:

  {uptime}     — stream uptime ("1h 23m" or "offline")
  {viewers}    — current viewer count
  {game}       — current category
  {title}      — broadcast title
  {followers}  — total follower count

Example commands you can build now:

  !uptime  → "We've been live for {uptime}!"
  !game    → "{user} we're playing {game} right now"
  !stats   → "{viewers} watching · {followers} followers · {game}"

### How it works

The substitution is async and only fires when a command's
response template actually references one of the new tokens.
Commands that only use the old `{user}` / `{args}` / `{channel}`
tokens are unchanged and incur zero Helix calls.

When dynamic tokens ARE in use, a 5-second snapshot cache
coalesces concurrent invocations — a busy chat hitting `!uptime`
once per chatter still only fires one Helix call every 5 s. The
existing per-command cooldown also stacks on top, so the
practical ceiling is comfortably under the Helix rate limit.

If Twitch / the network is unhappy, dynamic tokens degrade to
sane defaults (`offline`, `0`, `—`) so chat never sees a literal
`{viewers}` leak through.

### UI

The Commands tab gained an "Available response variables"
collapsible reference with all the supported tokens documented
inline.

## 1.11.0

New "Sources" tab — three new ways to bring external content
into a scene.

### Browser-source embeds

Drop arbitrary URL widgets (Streamlabs / Stream Elements alert
boxes, NightBot timers, donation tickers, custom Carbon
widgets) into a sandboxed full-bleed scene. Each embed gets a
stable slug-based scene URL you can promote to a preset.

- New scene route: `/scene/embed/<slug>` renders one embed in a
  `sandbox="allow-scripts allow-same-origin"` iframe so the
  widget can't reach the panel's cookies or `/api/*` routes.
- New API:
  `GET / POST /api/embeds`, `GET / PATCH / DELETE /api/embeds/<slug>`
  (GET is public-ish like other scene-supporting endpoints).
- Sources tab section to add / preview / delete embeds and
  one-click promote them to scene presets.

### Twitch VOD archive (rerun-as-scene)

Pulls your recent past broadcasts via Helix `GET /videos`.
Pick one, click "Use as scene", and a preset is created that
loads the Twitch embed player full-bleed. Useful for sleep
streams, intermissions, or 24/7 reruns between live blocks.

- New scene route: `/scene/vod/twitch/<id>` embeds the official
  Twitch player with `parent=` set to both the docker DNS host
  and the actual browser host (Twitch's embed accepts a
  comma-separated list), so it works in the streamer's headless
  Chromium AND in operator preview.
- New API: `GET /api/twitch/vods` (owner-only) lists the
  broadcaster's last 20 archive-type videos with thumbnails,
  duration, and published-at.

### Multi-key RTMP ingest

The v1.9.0 RTMP ingest accepted exactly one key ("cache" by
default). v1.11.0 adds a registry — push from multiple encoders
(`obs`, `phone`, `screen`, etc.) simultaneously and switch
between them as scenes.

- The legacy default key is unchanged (single-key flow keeps
  working). The multi-key registry is purely additive.
- New API:
  `GET / POST /api/ingest/keys`,
  `DELETE /api/ingest/keys/<key>`
- `/scene/ingest` now accepts `?k=<key>` to play back a specific
  key's feed; same scene route, just different query for each
  preset. `/api/ingest/status` honours the same `?k=` param.

### Sources tab

A single new tab in the admin shell hosts all three subsystems.
Each section saves immediately; adding a source doesn't take
effect on the broadcast until you switch to / reload the scene.

## 1.10.2

Two-part hotfix: RTMP ingest latency down from 60-120 s to
roughly 5-10 s, and scene switches no longer hard-cut.

### Low-latency RTMP ingest

The previous defaults were tuned for resilience over latency,
which added massive delay on top of Twitch's own HLS ingest.
v1.10.2 tightens both sides:

- **nginx-rtmp**: `hls_fragment 2s → 1s`, `hls_playlist_length
  10s → 3s`, `chunk_size 4096 → 1024`, `hls_sync 100ms`, plus
  `tcp_nodelay on; sendfile off; tcp_nopush off` on the HTTP
  side so segments flush as soon as they're written.
- **hls.js (in /scene/ingest)**: `backBufferLength 10 → 4`,
  `maxBufferLength 8 → 3`, new `maxMaxBufferLength: 6`,
  `liveSyncDuration: 1`, `liveMaxLatencyDuration: 4`,
  `maxLoadingDelay: 1`, plus an explicit `waiting`-event
  watchdog that snaps the playhead to `hls.liveSyncPosition`
  if it falls more than 2 s behind.

Realistic end-to-end budget (OBS → Twitch):
  OBS encode 1 s · nginx HLS 1 s · hls.js buffer 1.5 s · Chromium
  decode 0.2 s · FFmpeg encode 0.5 s · Twitch HLS ingest ~3 s
  → ≈ 7 s total.

Operators who drop their OBS keyframe interval to 1 s (Settings
→ Output) can pull this down to ~5 s on a fast LAN to the Pi.
Anything below ~5 s starts depending on Twitch behaviour we
can't control.

### Scene transitions

Switching scenes used to be a hard cut — the headless Chromium
reload flashed blank for ~500 ms before snapping in. v1.10.2
adds a 400 ms opacity+scale fade on `.cs-scene` mount (for
SceneFrame-based scenes) and a 350 ms body-level opacity ramp
(for Pet / Datacenter / Music / Ingest which manage their own
root). Both animations are GPU-only (transform + opacity) so
they hold 30 FPS in headless Chromium without burning extra CPU.

Opt-out per scene with `class="cs-scene cs-no-transition"` on
the wrapper.

## 1.10.1

Memory leak hotfix for the web + streamer containers. Symptom on
the Pi: web RSS climbed steadily over hours of streaming (often
past 1GB), eventually OOM-killing or just becoming sluggish.

### Root cause: SSE bus subscriptions leaked on scene reloads

`/api/chat/stream`, `/api/alerts/stream`, `/api/games/pet/stream`,
`/api/games/datacenter/stream` only ran cleanup when
`req.signal.abort` fired. Behind nginx / Cloudflare Tunnel that
event sometimes never propagates — the underlying socket closes
but the abort fires late or not at all. Meanwhile the streamer
reloads scene pages frequently (every scene switch, every
restart), opening fresh SSE connections each time. The bus
subscriptions from the old pages stayed attached, holding the
ReadableStream controller + closure-captured state in memory
forever.

Fix: extracted `lib/sse.ts` with a hardened lifecycle. Cleanup
now fires on the FIRST of: req.signal abort, an enqueue throwing
(socket dead but abort hasn't fired), or the keepalive enqueue
failing. All callbacks gate on `closed` so stale handlers can't
fire writes against a torn-down controller.

### Other leaks tidied

- **Streamer `musicFifoFd`** (v1.7.3 keep-alive) — `_spawnFFmpeg`
  is now idempotent: closes any stale fd before opening a new
  one. Previously a fast reconnect cycle could leak one fd per
  cycle.
- **Bus listener high-water warning** — `subscribe()` now logs
  `[bus] high listener count on "<topic>": <n>` when any topic
  exceeds 30 listeners, so future leaks of this class are loud
  instead of silent.

### New diagnostic endpoint

`GET /api/system/diag` (owner-only) reports `process.memoryUsage()`
+ live bus subscriber counts per topic. Curl it during a stream
to confirm the leak is gone: the counts should sit at a small,
stable value even after many scene switches.

## 1.10.0

Overlay pack — three new scene overlays + a global toggle UI,
plus quick-pick palette swatches for the accent colour.

### New scene overlays

All three are wired into every scene (built-in + custom) and
toggleable from the Branding tab. Each respects the global
accent colour and animates in/out so transitions feel
intentional.

- **Chat overlay** — recent chat messages in a corner stack,
  with `mod`/`sub` badges and the chatter's own colour. Auto-
  fades messages after 60s. Subscribes to the public
  `/api/chat/stream` SSE feed; no per-scene plumbing required.
- **Alerts ticker** — bottom marquee of recent follows, subs,
  gifts, cheers, raids. Pulled from `/api/alerts/stream` which
  the EventSub client was already publishing on. Glyph + colour
  per event type.
- **Stream stats badge** — corner pill showing LIVE indicator,
  uptime (seconds-precise client-side counter, hourly Helix
  poll), and current viewer count. Hides when Twitch reports
  the channel as offline.

### New API

- `GET /api/overlays/config` — public, used by scenes.
- `POST /api/overlays/config` — owner-only.
- `GET /api/twitch/live-public` — un-gated mirror of
  `/api/twitch/live` so scene overlays can read uptime +
  viewers without an OAuth cookie.

### Branding tab

- New "Scene overlays" card with per-overlay enable/corner
  controls. Saves are immediate.
- Accent picker now has eight quick-pick swatches (cyan,
  violet, hot pink, neon green, amber, blood red, sky blue,
  off-white). The OS colour picker is still there for arbitrary
  hex values.

### Migration

No data or env changes. After upgrading, enable whichever
overlays you want from Branding → Scene overlays. Defaults
keep Now Playing on (existing behaviour) and the new three
off (so existing streams look identical until you opt in).

## 1.9.3

One-click updates from the panel.

### What it does

The Status tab gains a **System** card showing the running
CacheStream version + the latest published GitHub release. When
a newer version is out, an "Update now" button pulls + rebuilds
+ restarts the containers without you ever needing to SSH in.

### How it works

The web container can't run `docker compose` against itself —
that would need Docker socket access, which is a much bigger
blast radius than this feature is worth. Instead the panel
writes a small marker file to the shared data volume, and a
host-side systemd watcher (`cachestream-updater.service`) is
the one that actually runs:

```
git pull --ff-only
docker compose pull
docker compose up -d --build
```

…then removes the marker. A tail of the updater's log appears
in the panel under a collapsible "Updater log" section so you
can see what happened.

### Installing the watcher

One-time on the host:

```
cd ~/CacheStream
sudo bash scripts/install-updater.sh
```

Until that's run, the panel shows the install command instead
of an "Update" button — failsafe; we never write the marker on
a host that wouldn't read it.

Uninstall: `sudo bash scripts/install-updater.sh --uninstall`.

### New endpoints

- `GET /api/system/version` — current + latest + update flag.
  Caches the GitHub call for 5 minutes; safe to poll from the UI.
- `POST /api/system/update` — writes the marker (412 if the
  watcher isn't installed).
- `GET /api/system/update` — current in-flight state + tail of
  the watcher log.

## 1.9.2

Build hotfix — the runner-stage `npm install music-metadata`
hack from v1.8.2 broke offline / flaky-DNS Pi builds with:

  npm error code EAI_AGAIN
  request to https://registry.npmjs.org/hls.js failed

(The runner stage was reading the builder's package.json and
trying to reconcile the new hls.js dep too.)

Root cause: `music-metadata` was in
`serverComponentsExternalPackages` so Next wouldn't bundle it,
which meant we had to install it again in the runner stage to
have it available at runtime. Worked but added a second network
round-trip during every build.

Fix: removed `music-metadata` from `serverComponentsExternalPackages`
so Next bundles it like any other dep. The runner stage now
contains zero `npm install` calls — pure file copies from the
builder. Offline rebuilds work. Pi DNS hiccups can't break the
build any more.

## 1.9.1

GHCR build hotfix — v1.9.0's release workflow failed to build
the web image. The ingest scene tried to `await import()` hls.js
from a remote CDN URL, which webpack rejects: "The target
environment doesn't support dynamic import() syntax so it's not
possible to use external type 'module' within a script".

Fixed by adding `hls.js` as a regular npm dependency and
importing it normally. Next's code-splitter still keeps it out
of every other route's bundle, so the size win is the same — it
only loads when /scene/ingest is first opened.

## 1.9.0

Four-feature release: fix the dead-chat regression, ship a
Now-Playing overlay for every scene, cut the music engine's CPU
usage, and add an RTMP ingest so you can stream OBS through
CacheStream to Twitch.

### Fixed: chat is dead after a fresh login

`bootOnce()` ran once at the very first API hit and set a
module-level `booted` flag. If the operator hadn't logged in
yet (fresh deploy, wizard not complete), the chat + EventSub
startup branch hit "no broadcaster tokens — skipping" and was
never re-entered. After login, `onTokensRefreshed()` called
`reconnectChatIfRunning()` which **bails when state === idle**
— so EventSub never connected, the
`channel.chat.message` subscription was never created, and chat
commands silently never fired any game handlers.

Fix: split boot into `bootOnce()` (one-shot init: games, music,
scene seeds) and `startServicesIfReady()` (idempotent: chat +
eventsub). The OAuth callback now calls
`startServicesIfReady()` after saving tokens, so the first
post-wizard chat works without a container restart.

### Added: Now Playing widget on every scene

`apps/web/src/app/scene/_shared/NowPlaying.tsx` is a small
bottom-corner overlay showing the current track's cover, title,
and artist (or the radio source). It's hooked into every scene
that uses `SceneFrame` (`brb`, `ending`, `offline`, `starting-
soon`, custom) and manually added to the AI Pet + Datacenter
scenes. The dedicated Music scene doesn't get it (it has its
own treatment).

Toggle off per scene via the `hideNowPlaying` prop on
`SceneFrame`. Cover cascade matches the music scene: track
cover → broadcaster logo → CD-icon placeholder. Animates in on
mount and out when music goes idle.

### Music / radio CPU cut

The music engine's writer was the single biggest non-encoder
CPU sink on the Pi 5 — `loudnorm=I=-16:LRA=11:TP=-1.5` in
real-time mode is expensive. Plus the music scene's visualiser
was painting at 60Hz with per-bar `shadowBlur` (canvas's most
expensive op).

Changes:
- `loudnorm` → `dynaudnorm=f=500:g=15:p=0.95`. ~5-10× cheaper
  with a very similar perceptual leveling result. Override via
  `MUSIC_LOUDNESS_FILTER=` env if you want the old behaviour.
- Visualiser FFT 512 → 256, bar count 64 → 48.
- Render loop paced to 30fps (we capture the page at 30fps —
  painting twice as often was wasted work).
- Per-bar `shadowBlur` removed; replaced with a single CSS
  `filter: drop-shadow()` on the canvas (GPU-composited once
  per frame instead of per-bar).

Expected impact: ~30-50% drop in the web container's user-CPU
while music is playing, depending on host.

### Added: RTMP ingest (OBS → CacheStream → Twitch)

New `ingest` compose service running `nginx-rtmp`. Push from
OBS (or any RTMP encoder) to
`rtmp://<host>:1935/live` with the configured stream key. The
ingest container wraps the feed as HLS chunks; the new
`/scene/ingest` page plays the HLS via `hls.js` in headless
Chromium. The streamer captures + re-encodes that page as
usual, so all of your overlays + chat games + Now Playing
widget still composite over the OBS feed on the way to Twitch.

- New compose volume: `cachestream-ingest-hls` (tmpfs would be
  ideal; using a named volume is fine for now).
- New env: `RTMP_PORT` (default 1935).
- Stream key defaults to the literal `cache`; rotate via the
  Stream Info card or `POST /api/ingest/config { rotateKey: true }`.
- Latency: typically 3-5s OBS → Twitch (HLS adds 2-3s of
  buffering on top of the existing CacheStream pipeline).

### Migration

- `docker compose pull && docker compose up -d --build` will
  start the new `ingest` container alongside the existing two.
- The new `RTMP_PORT` env defaults sanely; no .env edits
  required unless you want a different host port.
- Built-in scene presets gain "RTMP Ingest"; existing custom
  scenes are untouched.

## 1.8.2

Two music library fixes:

- **Scanner now actually reads tags + cover art.** Symptom
  before: titles like `10 Years Of NCS [8-OtWif8Z4A]`, no
  artist, generic placeholder covers everywhere even on files
  with proper ID3 tags + embedded artwork.

  Cause: `music-metadata` was marked as
  `serverComponentsExternalPackages` in `next.config.mjs` so Next
  doesn't bundle it, but Next 14's tracer doesn't reliably copy
  ESM-only externals into `.next/standalone`. At runtime the
  lazy `await import("music-metadata")` threw `MODULE_NOT_FOUND`
  and the scanner silently fell back to filename-only.

  Fix: the runner stage of the Dockerfile now `npm install`s
  `music-metadata` directly into the runtime image. Failures to
  load it also now surface in the music engine's `lastError`
  field so this class of bug isn't silent.

- **Scan prunes missing files.** Before, `scanLibrary()` upserted
  every file it found but never removed rows for files that
  disappeared. Deleted tracks lingered in the library forever
  and the count only ever climbed. The scanner now diffs the
  in-DB rows against the on-disk file set and deletes the
  orphans in the same pass.

After upgrading, click **Rescan** in the Music tab once. Tag-
parsed metadata + embedded covers will populate, and any
ghost entries from deleted files will be removed. Manually-
edited tracks (manual: true) are still preserved across scans.

## 1.8.1

- **Music scene falls back to the broadcaster's logo** for cover
  art when there's no track-embedded image. Cascade is now:
  track cover → broadcaster logo (from Branding tab) → built-in
  ♫ placeholder. Radio mode (which has no track-level artwork
  at all) now also shows the logo by default.

## 1.8.0

Chat is now Helix end-to-end. The hand-rolled IRC client + IRC
WebSocket transport are gone. AI Pet scene also gained an
always-visible command help bar.

### Helix chat migration

- **Receive**: `channel.chat.message` + `channel.chat.notification`
  added to the EventSub WebSocket client. Re-emits each message
  on the `chat` bus topic in the same `{ type, login, name,
  message, isMod, isSub, id }` shape the games / commands /
  AutoMod were already consuming, so downstream code is
  untouched.
- **Send**: `POST /helix/chat/messages`. Replaces the old IRC
  PRIVMSG over WebSocket. `sendChat(text)` keeps its synchronous
  signature so call sites don't have to be rewritten — errors
  are logged.
- **Scopes**: added `user:bot`, `user:read:chat`, `user:write:chat`.
  Legacy `chat:read` + `chat:edit` still requested so users
  mid-migration keep working until they re-login (the wizard's
  missing-scopes detector will nudge them).
- **Removed**: the ~250 lines of IRC WebSocket client + hand-
  rolled tag/prefix parser in `lib/twitch/chat.ts`.
- One less long-lived TCP connection: the EventSub WS we already
  keep alive for follows/subs/cheers/raids now carries chat too.

### UI

- **AI Pet scene** now shows a persistent command help bar:
  `!feed · !pet · !play · !sleep · !teach · !hit`. Datacenter
  already had its equivalent; this matches the style.

### Migration note

Existing operators **must re-login** after upgrading so their
token picks up the new `user:bot` / `user:read:chat` /
`user:write:chat` scopes. The Status tab / chat panel will
surface a "missing scopes — please re-login" warning until that
happens. No data migration is required; just a fresh OAuth
roundtrip.

## 1.7.6

Fixes a race in the chat + EventSub clients that caused every
chat message to be processed 2-3 times. Symptom: chat commands
like `!feed` mutating the pet stats 3x per send; activity feeds
showing duplicate entries.

- **Chat + EventSub `start()` flip state synchronously** before
  awaiting `getAccessToken()`. The old guard
  `if (state === "connecting" || state === "connected") return`
  was bypassed by concurrent callers (boot, /api/chat/status
  POST, OAuth callback) because state was set inside the awaited
  `_connect()` — all three races opened their own WebSocket and
  each registered an `on("message")` handler on the same client,
  multiplying every incoming message by the race count.

## 1.7.5

The streamer-side keep-alive fd alone (v1.7.3) wasn't enough to
unblock FFmpeg's open on music.fifo. FFmpeg's PCM s16le demuxer
appears to need an actual writer producing bytes, not just an
fd held open. Adding a dedicated silent-PCM filler on the web
side that always writes to music.fifo when no track is playing.

- **Second silence filler on the web side** dedicated to
  music.fifo. Suspended while a real track plays, resumed when
  the track ends. Both fillers boot at music-engine
  construction time so both FIFOs always have a writer when the
  streamer's FFmpeg opens them.
- **Confirmation log on streamer side** for the keep-alive fd
  open (`music fifo keep-alive opened`). Helps tell apart "fd
  held but FFmpeg still hung" from "fd open failed silently".

## 1.7.4

Hotfix for v1.7.3 — the music.fifo keep-alive open failed with
`EACCES: permission denied` on hosts where the FIFO was created
by the web container (different UID) with the default mode 0644.
FFmpeg still hung on `open(music.fifo, O_RDONLY)` because there
was no writer.

- **Both entrypoints chmod existing FIFOs to 0666 while still
  root**, before dropping privileges. Catches FIFOs created by
  older versions or by the other container.
- **Web container's `_ensureFifos` uses `mkfifo -m 666`** and
  re-chmods existing FIFOs to 0666 on every boot.

If your v1.7.3 deploy showed
`could not open music fifo as keep-alive writer` with
`EACCES: permission denied`, rebuild with 1.7.4 and it'll work.

## 1.7.3

Fixes the real cause of "running but no frames at Twitch": the
streamer's FFmpeg was hanging forever on the music FIFO open.

- **Streamer holds music.fifo open O_RDWR for FFmpeg's lifetime.**
  FFmpeg's `-f s16le -i music.fifo` opens the FIFO O_RDONLY,
  which blocks on Linux until a writer exists. The music engine
  (web container) only writes to music.fifo while a track is
  playing — so on a fresh start with no music queued, FFmpeg
  hung on `open()` and never reached the encode / RTMP stage.
  The TCP socket to Twitch was never opened. Twitch's Stream
  Health page correctly showed `Offline` with zero bitrate even
  though our internal `frameCount` kept climbing (counts MJPEG
  frames arriving from Chromium, not frames actually published).
- Fix: the streamer opens music.fifo O_RDWR|O_NONBLOCK itself
  before spawning FFmpeg and holds the fd until the FFmpeg
  process exits. RDWR counts as a writer, so FFmpeg's RDONLY
  open returns immediately. We never write into the fd; the
  real music engine is still the only producer of audio data.
  When music is idle, amix in the filter graph reads nothing
  from music.fifo and falls back to silence.fifo as designed.

If you upgraded straight to 1.7.x and the broadcast went yellow
`ENCODING · WAITING FOR TWITCH` but Twitch's dashboard stayed
`Offline` with no bitrate, this is the fix.

## 1.7.2

Fixes the Status badge that stayed red on `RUNNING · NOT ON
TWITCH` even when the broadcast was healthy and Twitch was
accepting frames.

- **`ingestAccepted` is now time-based, not regex-based.** The
  old detection grepped FFmpeg stderr for `Output #0` / `Stream
  mapping:`, but those lines only appear at `-loglevel info`.
  CacheStream runs FFmpeg at `-loglevel warning` by default, so
  the flag never flipped to true and the panel never showed
  `LIVE on twitch` — even with thousands of frames pushed.
- Replacement: if FFmpeg is still running 8 s after spawn
  without having logged a rejection-shaped error (connection
  refused, broken pipe, `av_interleaved_write_frame`, etc.),
  the stream is treated as accepted. Twitch closes the TCP
  socket within ~5 s if it's going to reject, so the 8 s window
  is well past any realistic reject path.
- Rejection patterns still flip `ingestAccepted` back to false
  if they show up after the grace window — the panel will
  re-redden on a mid-stream drop.

## 1.7.1

Fixes the boot-loop introduced by v1.7.0's `.env` slim-down.

- **`INTERNAL_API_TOKEN` is now actually auto-generated**.
  v1.7.0 docs claimed it was, but `config.js` still required it
  via `required()` and the streamer crash-looped on every fresh
  deploy.
- Both containers' entrypoints now bootstrap the token via a
  shared file at `/app/audio/.internal-api-token`:
  - **Web container** writes the token (from `.env`, an existing
    file, or freshly generated) and exports it to its own env
    before exec'ing Node.
  - **Streamer container** waits up to 30 s for the file to
    appear, reads it, exports to env, then starts Node.
- If `INTERNAL_API_TOKEN` is set in `.env`, both containers
  honour it as before — no behaviour change for pinned deploys.

If you saw `streamer failed to start: Missing required
environment variable: INTERNAL_API_TOKEN` after upgrading to
1.7.0, rebuild with 1.7.1 and it'll just work.

## 1.7.0

The "you should never have to touch .env again" release.

### Setup wizard

- New first-run wizard at **`/setup`**. Fresh deploys with no
  config automatically redirect there from `/` and `/admin`.
- Three steps: PUBLIC_URL preflight, Twitch developer app
  (client id + secret, with copy-paste-friendly OAuth redirect),
  and login. The wizard self-resumes where you left off if
  interrupted between steps.
- `SESSION_SECRET` is auto-generated on first boot — no more
  `openssl rand -hex 48` ritual.
- Setup state is persisted to SQLite (kv) so a container restart
  doesn't re-trigger the wizard.

### Twitch stream key — pulled from OAuth, not pasted

- New `channel:read:stream_key` scope on the OAuth login.
- On every successful login, the panel auto-fetches the current
  stream key via Helix and hot-loads it into the streamer. No
  more `.env` editing when you rotate the key on Twitch.
- "Fetch from Twitch" button in Stream Info → Stream key & ingest
  for manual refresh after a Twitch-side rotation.

### Real "are we live on Twitch" check

- New `GET /api/twitch/live` route polls Helix `GET /streams` for
  the broadcaster's actual public live status.
- Status badge is now three-state:
  - 🟢 **LIVE on twitch** — encoding + ingest accepted + Helix
    confirms the channel is visible.
  - 🟡 **encoding · waiting for twitch** — pushing bytes, ingest
    ACK'd, but Helix doesn't see the channel yet (propagation
    or silent reject).
  - 🔴 **running · not on twitch** — FFmpeg pushing, Twitch
    silently rejected at the RTMP layer (wrong key, duplicate
    session).
- Twitch viewer count + title surface as additional metrics when
  live.

### `.env` slimmed down

The example file is now ~30 lines. Only `PUBLIC_URL` is truly
required pre-wizard. Everything else has been moved to the panel:
OAuth credentials, session secret, stream key, ingest URL, all
encoder knobs, runtime behaviour.

Existing v1.6 `.env` deployments keep working unchanged — the
settings layer cascades `kv → .env → default`, so anything you
had in `.env` before is still picked up.

### Migration from v1.6

1. Pull v1.7.0, rebuild containers.
2. If your `.env` has `TWITCH_CLIENT_ID` set, the wizard is
   automatically considered complete and you go straight to
   `/admin` as before.
3. If you want the fresh-install experience: delete the OAuth
   vars from `.env`, restart the web container, visit `/` — the
   wizard will walk you through it.
4. To re-run the wizard later (e.g. rotate the dev app secret),
   visit `/setup?force=1`.

## 1.6.0

A reliability + portability release. Boots clean on a Raspberry
Pi (where v1.5 was failing), auto-tunes encoder settings per
host, ships pre-built multi-arch images, and exposes the stream
key in the dashboard so you never have to edit `.env` to rotate
it.

### Headline features

- **Auto-adaptive CPU profile** — detects the host and picks
  resolution / bitrate / codec / preset automatically.
- **Pi 4 / Pi 5 / weak-ARM aware** — Pi 5 specifically skips the
  dead V4L2 H.264 encoder block (BCM2712 has no HW H.264). Pi 4
  uses `h264_v4l2m2m` when available.
- **Hardware encoder probing** — NVENC / QSV / V4L2 M2M /
  VideoToolbox auto-selected when present. Runtime fallback to
  `libx264` if the HW path errors out.
- **Thermal monitor** — Pi-style hosts auto-throttle to a safe
  profile if CPU temp > 80°C, restore on cool-down.
- **Twitch ingest health signal** — Status badge now goes red
  `RUNNING · NOT ON TWITCH` if FFmpeg never sees the RTMP
  handshake confirmation, instead of falsely showing green.
- **Stream key + ingest URL in the dashboard** — Stream Info →
  Stream key & ingest. Hot-restarts FFmpeg on save (~5 s
  reconnect, no container restart, no `.env` edit).
- **Two-FIFO music architecture** — silence carrier on a
  dedicated FIFO + real music on a second, both `amix`-ed by the
  streamer. Track changes no longer interrupt the broadcast.
- **Pre-built multi-arch images** on GitHub Container Registry
  (`amd64` + `arm64`). Skip the local build with the new
  `docker-compose.ghcr.yml` overlay.
- **Examples directory** — copy-paste templates for three scenes
  (countdown poster, now-playing card, chat leaderboard) and two
  games (`!8ball`, full-stack reaction race).

### Fixed

- **`mkfifo: Permission denied` on the audio FIFO** — the shared
  `/app/audio` volume was racing chowns between the web (`nextjs`)
  and streamer (`streamer`) entrypoints. Now both just `chmod
  0777` the IPC dir (it only contains named pipes).
- **FFmpeg reconnect loop on track changes** — single-FIFO design
  killed/restarted the writer on every track, briefly producing
  EOF on the streamer's read side. Twitch saw "audio stream
  ended" and dropped the connection. Two-FIFO split (silence
  carrier + music writer) eliminates the EOF window entirely.
- **`MaxListenersExceededWarning`** — screencast handler attached
  a no-op `drain` listener on every backpressured write. Removed.
- **Stream key leaking into logs** — FFmpeg's stderr echoed the
  full RTMP URL on errors. Now redacted via stderr-side string
  replacement.

### Auto-adaptive encoding

`STREAM_PROFILE=auto` (the new default) detects the host on boot:

| Detected host       | Resolution | FPS | Codec choice                                  | Bitrate       |
|---------------------|-----------:|----:|-----------------------------------------------|--------------:|
| Raspberry Pi 4      | 720p       | 30  | `h264_v4l2m2m` (HW) → libx264 ultrafast       | 2800–3500 kbps |
| Raspberry Pi 5      | 720p       | 30  | libx264 ultrafast (no HW H.264 on BCM2712)    | 2800 kbps     |
| Weak ARM (≤4 cores) | 720p       | 30  | libx264 ultrafast                             | 3000 kbps     |
| 1–2 core x86        | 720p       | 30  | libx264 veryfast                              | 3500 kbps     |
| 4–8 core x86        | 1080p      | 30  | libx264 veryfast (zerolatency)                | 4500 kbps     |
| 12+ core x86        | 1080p      | 60  | libx264 medium (no zerolatency)               | 6000 kbps     |

Explicit env vars (`STREAM_WIDTH`, `STREAM_VIDEO_CODEC`, etc.)
still win over the auto pick.

### Pre-built images on GHCR

```bash
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml up -d
```

Multi-arch (`amd64` + `arm64`) built on every `v*` tag by
`.github/workflows/release.yml`. Pin a version with
`CACHESTREAM_VERSION=1.6.0`.

### Status surface

The Status tab now shows:
- **Codec** — what the streamer is actually encoding with
- **Auto-profile** — picked category + host signature
- **CPU temp** — live temperature, red when thermally throttled
- **`RUNNING · NOT ON TWITCH`** — when FFmpeg is fine but Twitch
  rejected the handshake (wrong key, duplicate stream session)

### New API endpoints

- `GET /api/twitch/ingest` — returns masked key + ingest URL +
  source (kv override vs `.env` fallback)
- `PATCH /api/twitch/ingest` — set / clear key + URL, pushes to
  streamer over RPC, hot-restarts the broadcast

Plus a new streamer RPC endpoint `POST /ingest` for runtime
credential updates without container restart.

### Examples

New `examples/` directory ships drop-in templates so newcomers
don't have to read the whole codebase to make their own:

- `examples/scenes/` — countdown poster, now-playing card, chat
  leaderboard
- `examples/games/8ball/` — minimal command-response (the
  smallest possible chat game)
- `examples/games/reaction/` — full-stack reaction race with
  schema migration, engine, three API routes, SSE, and a scene

### Migration from 1.5

`docker compose build && docker compose up -d` is the whole
upgrade. No DB migrations beyond what the schema runner does
automatically. Your existing `.env` continues to work — auto-
profile honours explicit overrides if set, falls back to host
detection otherwise.

If you want the auto-picked values to actually show up in your
logs, blank out the encoder-related `STREAM_*` env vars:

```bash
sed -i 's/^STREAM_WIDTH=.*/STREAM_WIDTH=/'         .env
sed -i 's/^STREAM_HEIGHT=.*/STREAM_HEIGHT=/'        .env
sed -i 's/^STREAM_FPS=.*/STREAM_FPS=/'              .env
sed -i 's/^STREAM_VIDEO_BITRATE=.*/STREAM_VIDEO_BITRATE=/'   .env
sed -i 's/^STREAM_VIDEO_MAXRATE=.*/STREAM_VIDEO_MAXRATE=/'   .env
sed -i 's/^STREAM_VIDEO_BUFSIZE=.*/STREAM_VIDEO_BUFSIZE=/'   .env
sed -i 's/^STREAM_PRESET=.*/STREAM_PRESET=/'        .env
sed -i 's/^STREAM_X264_THREADS=.*/STREAM_X264_THREADS=/'     .env
sed -i 's/^STREAM_X264_TUNE=.*/STREAM_X264_TUNE=/'           .env
docker compose restart streamer
```

## 1.5.0

Scenes get a real story — every broadcast staple is now a real
Next.js route, the operator can author their own from the panel,
and a unified branding store keeps name + logo + colour consistent
across every surface.

### Added

**Built-in scenes**
Four new full-screen routes ship out of the box, all sharing a
cyberpunk frame, optional background image, and the operator's
branding ribbon:
- `/scene/starting-soon` — animated standby with optional ISO
  countdown via `?at=YYYY-MM-DDTHH:MM:SSZ`.
- `/scene/brb` — calm "be right back" intermission card.
- `/scene/ending` — off-air thank-you with optional social handles
  (Twitch / YouTube / X / Discord) passed via query params.
- `/scene/offline` — neutral idle fallback.

Each accepts `?title=`, `?subtitle=`, `?accent=`, `?bg=` overrides,
so they double as one-shot URLs (no DB row needed for quick swaps).

**Custom scene builder**
- New **Scenes** admin tab.
- Template builder with five layouts: *Starting Soon*, *BRB*,
  *Ending*, *Generic*, *Raw HTML / CSS*.
- Each scene gets a URL-safe slug; served at `/scene/custom/<slug>`.
- Per-template field set: title / subtitle / accent / background /
  countdown / social row / inline HTML+CSS.
- Edit + delete + "Save as preset" + "Copy URL" + "Open preview"
  from one place. Slug collisions auto-suffix on create.
- Raw HTML is the escape hatch — anything Chromium can render,
  scoped to the owner.

**Shared scene primitives**
`apps/web/src/app/scene/_shared/`:
- `SceneFrame.tsx` — full-bleed shell (animated grid, scanlines,
  radial wash, brand ribbon, corner footer). Drives every built-in
  + custom scene from a single source.
- `Countdown.tsx` — clamped wall-clock countdown card.
- `SocialRow.tsx` — conditional handle pills.
- `scene-base.css` — accent-aware CSS custom properties so a single
  `accent` value retints glows / borders / countdown digits.

**Branding (logo + name + colour, everywhere)**
- New **Branding** admin tab.
- Streamer display name, tagline, accent colour, and logo upload
  (PNG / JPG / WEBP / SVG / GIF, up to 4 MB).
- Stored in the existing kv table; logos live under
  `<DATA_DIR>/branding/` and serve from `/api/branding/logo` with
  a cache-busted version param.
- Surfaces:
  - Every built-in + custom scene's top-left ribbon.
  - The public landing page (logo + display name + tagline +
    accent-tinted gradient and primary button).
  - The admin panel header.
- Inline preview frame in the Branding tab so changes are visible
  before saving.

**Public + auto-seeded scene presets**
On first 1.5 boot, the eight built-in scene URLs are seeded into
`scenes` so they appear in the Studio + Status dropdowns without
manual entry. Deleting a preset is sticky — restarts don't
recreate it.

### Schema

- v4 migration: `custom_scenes` table (`id`, `slug`, `name`,
  `template`, `config_json`, timestamps). Runs automatically.

### API

```
GET    /api/scenes/custom
POST   /api/scenes/custom              { name, template, slug?, config }
GET    /api/scenes/custom/:id
PATCH  /api/scenes/custom/:id          { name?, slug?, template?, config? }
DELETE /api/scenes/custom/:id

GET    /api/branding                   (public — scenes need it)
PATCH  /api/branding                   { displayName?, tagline?, accent? }
GET    /api/branding/logo              (public stream of the logo)
POST   /api/branding/logo              multipart file upload
DELETE /api/branding/logo
```

### Notes

- Updating branding doesn't restart the broadcast — existing
  scenes pick up the new logo / name / accent the next time the
  scene URL is loaded by the streamer (e.g. on **Take** in Studio
  or a scene switch from Status). For an immediate refresh, hit
  **Restart** on the Status tab.

## 1.4.0

Studio gets a real editor; Music gets uploads, tags, cover art, a
radio-style scene; VODs (pre-recorded video) are now a first-class
broadcast source.

### Studio mode — full rewrite

The v1.3 side-by-side mini-iframes were an eyesore. v1.4 swaps to:

- **Single large preview canvas** with proper letterboxing.
- **Small floating Program (live) thumbnail** in the bottom-right so
  you always see what's actually broadcasting.
- **Sidebar** with categorised layer-adding buttons, a layer list
  with selection state, and a per-layer inspector (text/HTML/source +
  x/y/width/height numeric inputs).
- **Resolution + zoom badge**, optional **Grid** and **Thirds**
  overlay toggles for composition.
- **Selection state** — clicking a layer shows the resize handle and
  highlights it on the canvas; clicking the empty canvas deselects.
- Empty-state copy guides first-time users to the bundled scenes
  (`/scene`, `/scene/pet`, `/scene/datacenter`, `/scene/music`).

### Music — uploads, tags, cover art, radio scene

- **Upload from the panel** — drop MP3 / FLAC / OGG / WAV / OPUS up
  to 200 MB each. Files land in `./media/music`.
- **`music-metadata` tag parser** runs on upload and rescan: title /
  artist / album / duration pulled from ID3 / Vorbis / FLAC tags;
  embedded cover art extracted into `./data/covers/`.
- **Per-track edit** — title, artist, album editable inline in the
  Music tab. Manually-edited tracks are marked `edited` and won't be
  clobbered by future rescans.
- **Per-track delete** — removes the DB row and the file.
- **Now-playing cover thumbnail** in the Music tab + a track list
  with cover thumbnails for everything in the library.
- **New `/scene/music` scene** — radio-station style display with:
  - Large album art + spinning vinyl decoration
  - Track title / artist / album
  - Real audio visualiser (Web Audio AnalyserNode on the same file
    the streamer is broadcasting — synced within ~200 ms). Falls back
    to procedural bars for radio mode (CORS blocks real analysis).
  - Live clock, station label, ON-AIR badge.

### VODs — pre-recorded broadcast

A whole new broadcast mode parallel to the live-scene pipeline.

- **VOD tab** in the admin panel.
- **Upload** MP4 / MOV / MKV / WEBM / M4V (up to 4 GB per file via
  the panel; for larger files, SFTP into `./media/vods` then click
  **Scan dir**).
- **Add remote URL** for any HTTP(S) / RTMP source FFmpeg can ingest.
- **Per-VOD edit + loop + delete.**
- **Play** swaps the broadcast off the Chromium scene pipeline and
  spawns a dedicated FFmpeg streaming the file/URL directly to
  Twitch (no Chromium round-trip). **Stop** returns to the scene.

### Schema

- v3 migration: `music_tracks.album`, `music_tracks.cover_path`,
  `music_tracks.manual` columns added (defensive, idempotent).
- New `vod_sources` table.

### Compose / volumes

- `./media/music` is now mounted **read-write** so panel uploads work.
- New `./media/vods` mount — read-write on web (uploads + delete),
  read-only on streamer (playback).
- The streamer container gets the same `/app/media/vods` path so the
  web container can hand it a resolved file path safely.

### Dependencies

- `music-metadata@^7.14` added to the web container. Pinned at v7
  (CJS) because v8+ is ESM-only and adds friction with Next's
  standalone output.

## 1.3.0

UI + games + CPU optimisation pass. No new external services.

### Added

**Studio mode**
- New **Studio** tab in the admin panel: side-by-side preview /
  program with iframe stages scaled to 32% (~614×346 of the
  1920×1080 stage).
- **Moveable overlays** — drag/resize layers directly on the
  preview. Numeric positions (top/left/width/height in px) are
  persisted back into the overlay set's JSON.
- **Take → Program** button atomically switches the live scene
  + applies the draft overlay set. If no set is selected, the
  draft saves as a new "Studio draft" set on the fly.

**AI Pet creature** (`/scene/pet`)
- Persistent creature with 6 stats (hunger, happiness, energy,
  intelligence, aggression, morality), age in minutes, evolution
  tier (4 tiers: Datablob → Loglurker → Cachewyrm → Stackwraith).
- Tick loop (15s) drifts personality back toward 50, drains
  hunger/energy, triggers evolutions when intelligence crosses
  thresholds.
- Chat commands: `!feed`, `!pet`/`!pat`, `!play`, `!sleep`,
  `!teach <word>` (mod-only), `!insult`/`!hit`.
- Cyberpunk creature scene with animated bobbing, evolving eye
  colour per tier, mood label derived from stats, and a live
  feed of recent mutations.

**Twitch Plays Datacenter** (`/scene/datacenter`)
- NOC-aesthetic management sim: servers, power, coolant,
  temperature, uptime, attacks, budget, reputation.
- Tick loop (10s) heats up under load, recovers under coolant,
  spawns random cyberattacks, awards budget for healthy uptime.
- Chat commands: `!add-server`, `!defend`, `!cool`, `!power+`,
  `!invest`, `!restart`.
- Live event feed and rack visualisation built straight into
  the scene; no extra widgets needed.

**Admin Games tab**
- Live stats for both games, rename pet, reset either game.

### CPU optimisation

Streamer hot path reworked to spend less encoder time per frame.
Typical 1080p30 install drops ~15-25% CPU at default settings.

- **Smaller filter graph** — dropped the redundant
  `format=yuv420p` step (covered by `-pix_fmt yuv420p`),
  switched scaler from `bicubic` to `bilinear` (visually
  identical when in/out match; ~2-3× cheaper otherwise).
- **Lower screencast JPEG quality** — Chromium → FFmpeg JPEG
  pipe now defaults to quality 70 (was 80). Less encode +
  decode CPU; identical perceived quality after H.264.
- **New env knobs**:
  - `STREAM_X264_THREADS` — pin x264 worker count (0 = auto)
  - `STREAM_X264_TUNE` — override or clear `-tune zerolatency`
  - `STREAM_SCREENCAST_QUALITY` — Chromium JPEG quality (1-100)
  - `STREAM_CAPTURE_EVERY_NTH` — drop frames on capture (e.g.
    set to 2 if you only need 30fps from a 60fps scene)
- **Slower admin polling** — status tab cadence 3s → 5s.
- **Schedule scenes that aren't in use** so Chromium can paint
  cheap scenes when no one's watching the heavy ones.

### Schema migrations

- `pet_state` + `datacenter_state` tables added. Migration runs
  automatically on first 1.3 boot.

### Files of note

```
apps/web/src/lib/games/{pet,datacenter}.ts   tick loops + chat hooks
apps/web/src/app/scene/{pet,datacenter}/     scene routes (1920×1080)
apps/web/src/app/admin/tabs/StudioTab.tsx    moveable overlay editor
apps/web/src/app/api/games/**                game APIs + SSE
apps/streamer/src/{config,stream}.js         CPU tuning knobs
```

## 1.2.0

Tier-A platform release. Everything new sits on top of the
v1.1 streamer + control panel.

### Added

**Twitch API foundation**
- Broadcaster OAuth tokens are persisted and auto-refreshed (60s
  safety buffer). Stored in SQLite, never returned to the browser.
- Expanded OAuth scopes:
  `user:read:email`, `channel:manage:broadcast`,
  `channel:read:subscriptions`, `bits:read`,
  `moderation:read`, `moderator:manage:banned_users`,
  `moderator:manage:chat_messages`, `moderator:read:followers`,
  `chat:read`, `chat:edit`.
- The chat status banner detects missing scopes from a stale
  token and offers a one-click re-authorize link.
- Helix API client with channel info, category search, stream
  lookup, chat deletion, ban/timeout.

**Stream info management**
- New **Stream Info** tab — edit title, category (debounced
  Twitch category search), tags, broadcaster language. Shows
  live viewer count when broadcasting.

**Chat (read + write + auto-reply)**
- Long-lived Twitch IRC client over WebSocket. Hand-rolled
  parser, auto-reconnect with exponential backoff, IRC PING/PONG.
- **Chat** tab: connection state badges, live message feed (SSE),
  message composer.
- `/api/chat/stream` (SSE) is reachable without auth so overlay
  iframes can subscribe inside the headless browser.
- `/widgets/chat` — drop-in chat overlay widget; add as a `chat`
  overlay layer with `src=http://web:7788/widgets/chat`.

**Custom commands + AutoMod**
- Per-trigger cooldowns, mod-only / sub-only flags, response
  templating: `{user}`, `{channel}`, `{arg1}`…`{args}`.
- AutoMod rules with `contains` / `startswith` / `regex` matching
  and `delete` / `timeout` / `ban` actions.
- **Commands / AutoMod** tab with both editors.

**EventSub alerts**
- WebSocket EventSub client. Subscribes to follow, sub, gift,
  resub, cheer, raid on session welcome. Handles `session_reconnect`
  hand-off cleanly.
- **Alerts** tab — live feed of incoming events.
- `/widgets/alert` — drop-in alert popup widget; add as an `alert`
  overlay layer.

**Music / Radio**
- Local library: drop MP3/OGG/FLAC/WAV/OPUS into `./media/music`
  on the host, click Rescan in the panel.
- Internet radio: any Icecast/Shoutcast URL or direct stream URL.
  Save as named presets.
- Volume control, loop, shuffle.
- Audio is mixed into a shared named pipe (`/app/audio/mix.fifo`)
  that the streamer's FFmpeg consumes. Music changes never
  interrupt the video stream.
- Silent fallback (`anullsrc`) is `amix`-merged with the FIFO so
  the broadcast always has an audio track, even with nothing
  playing.

### Changed

- **Persistence** moved from `data/state.json` to SQLite
  (`data/cachestream.db`). One-shot migration runs on first 1.2
  boot — the JSON file is read, copied, and renamed to
  `state.json.migrated-<timestamp>`. Safe to leave in place;
  remove once you've confirmed the new DB has your data.
- Admin panel split into tabs: **Status / Stream Info / Chat /
  Commands & AutoMod / Alerts / Music**. The v1.1 sections
  (presets, overlays, scheduler) all live under **Status**.
- Overlay types expanded: `text`, `html`, `image`, `chat`, `alert`.
  `chat` and `alert` overlays inject an `<iframe>` so widget JS
  runs in isolation.

### Dependencies

- Added: `better-sqlite3`, `ws` (+ `@types/*` dev deps).
- The web container now includes `ffmpeg` for the music encoder.

### Migration notes

If you're upgrading from 1.1:

1. `git pull && docker compose build`.
2. Run `docker compose up -d`. The SQLite migration runs once;
   you'll see a `[db] migrated state.json → SQLite` line in the
   web container logs.
3. Visit `/admin` and click **Re-authorize** (the chat status
   banner will prompt you) so the new OAuth scopes are granted.
4. Optional: create `./media/music` on the host and drop some
   tracks in.

The new audio FIFO is created automatically on streamer boot.

## 1.1.0

- Initial split into `apps/web` (Next.js) + `apps/streamer`
  (Puppeteer/FFmpeg worker).
- Twitch OAuth (first-login-wins) with HMAC-signed cookies.
- Control panel: live status, scene presets, overlay sets,
  minute-resolution scheduler.
- Cyberpunk Hello World scene at `/scene`.
