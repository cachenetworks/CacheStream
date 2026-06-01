<div align="center">

<br/>

```
╔═════════════════════════════════════════════════════════════════╗
║                                                                 ║
║    ▄▄▄  ▄▄   ▄▄▄ █  █ ▄▄▄       ▄▄▄ ▄▄▄▄ ▄▄▄  ▄▄▄   ▄▄  ▄   ▄   ║
║   █    █▄▄█ █    █▄▄█ █▄▄      ▀▀█▄   █  █▄█  █▄▄  █▄▄█ █▄█▄█   ║
║   █▄▄▄ █  █ █▄▄▄ █  █ █▄▄▄     ▄▄▄█   █  █ █▄ █▄▄▄ █  █ █ █ █   ║
║                                                                 ║
╚═════════════════════════════════════════════════════════════════╝
```

# CacheStream

**Fully headless Twitch streaming, with a real control panel.**

Render any webpage with headless Chromium, encode with FFmpeg, push
to Twitch RTMP — all without a desktop, X11, OBS, or a GPU. A
Next.js panel handles login, chat, alerts, music, VODs, custom scenes,
overlays, scheduling, and a couple of chat-driven games.

<br/>

![version](https://img.shields.io/badge/version-1.14.0-00f0ff?style=for-the-badge)
![docker](https://img.shields.io/badge/docker-compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![nextjs](https://img.shields.io/badge/Next.js-14-000?style=for-the-badge&logo=nextdotjs)
![twitch](https://img.shields.io/badge/Twitch-OAuth2-9146FF?style=for-the-badge&logo=twitch&logoColor=white)
![license](https://img.shields.io/badge/license-MIT-4ade80?style=for-the-badge)

<br/>

</div>

---

## What it does

```
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│   Webpage          Headless             FFmpeg            Twitch   │
│   (any URL)  ────► Chromium   ────────► libx264 / HW ───► RTMP     │
│                    (CDP                 yuv420p                    │
│                     screencast)         + AAC                      │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
                          ▲
                          │  start / stop / scene / overlay / music / VOD
                          │
                ┌─────────┴─────────┐
                │  Next.js panel    │
                │  /admin           │      Twitch OAuth2 login,
                │                   │      chat, alerts, scenes,
                │  (Twitch login)   │      music, VODs, games,
                └───────────────────┘      branding, scheduler
```

- **No virtual display.** No Xvfb, no X server, no DISPLAY env var.
- **No OBS.** No browser sources. No scene compositing in userspace.
- **No GPU required.** Software encoding works fine. Hardware encoders
  auto-detected and used when available (Pi VC4, NVENC, QSV, VideoToolbox).
- **No desktop environment.** Runs on a bare Ubuntu Server, a Raspberry Pi,
  or any Docker host with nothing else installed.

---

## Highlights

| | |
|---|---|
| 🎬 **Scenes are webpages** | Anything Chromium can render — Grafana dashboards, your own React app, a CodeMirror editor, a Notion page. Bundled scenes for Starting Soon / BRB / Ending / Offline / Music / Pet / Datacenter / RTMP Ingest. |
| 🛂 **OAuth2 login + invites** | Twitch authorization-code flow, first-login-wins ownership, HMAC-signed cookies, auto-refresh. Owner can invite moderators to drive the panel (`v1.13`). |
| 💬 **Real chat** | Twitch chat over **Helix + EventSub** (`v1.8`) — read, write, custom command engine with cooldowns and live-stat variables (`{uptime}`, `{viewers}`, `{game}`, …), AutoMod rules (`delete` / `timeout` / `ban`). |
| 🔔 **EventSub alerts** | Follows / subs / gifts / resubs / cheers / raids via WebSocket EventSub, with a drop-in popup widget. |
| 🖼️ **Scene overlays** | Chat box, alerts ticker, Now Playing card, uptime/viewer badge — each toggleable per scene from the Branding tab (`v1.10`). |
| 📡 **RTMP ingest** | Push from OBS (or any RTMP encoder) to CacheStream, render it as a scene, composite overlays on top, forward to Twitch. Multi-key support (`v1.11`). |
| 🎞️ **Browser-source embeds + VOD reruns** | Drop Streamlabs/NightBot widgets into a sandboxed scene; rerun past Twitch broadcasts as scenes (`v1.11`). |
| 🎨 **Studio mode** | Drag/resize overlays on a 1080p preview canvas, side-by-side with the live program feed. Take-to-program in one click. |
| 🎵 **Music + radio** | Upload MP3/FLAC/OGG, parse tags + cover art, queue / loop / shuffle / volume. Or stream any Icecast/Shoutcast URL. Audio mixed via shared FIFO so changes never drop the video. |
| 📼 **VOD broadcast** | Stream pre-recorded files or remote URLs through a separate FFmpeg pipeline. No Chromium round-trip → much lower CPU. |
| 🧬 **Auto-CPU tuning** | Detects Pi vs ARM vs x86, picks resolution / bitrate / encoder. Hot-throttles to 720p if the CPU temp hits 80 °C, restores on cool-down. |
| 🎮 **Chat games** | Tamagotchi-style AI Pet + "Twitch Plays Datacenter" sim, both driven by chat commands. |
| 🛞 **Scheduler** | Minute-resolution rotation across scenes + overlay sets, per-day-of-week. |
| 🪪 **Branding** | Upload a logo, set a display name + tagline + accent colour. Threads through every scene + the landing page + the admin header. |
| 📱 **Mobile control panel** | The admin UI tightens to a drawer + stacked layout under 700 px so you can switch scenes from your phone (`v1.13`). |
| 🛡️ **Long-stream stability** | Frame-flow watchdog, periodic Chromium recycle, memory-pressure auto-recycle, bounded teardown. Multi-day streams stay healthy (`v1.13.3`–`v1.13.5`). |
| 🔄 **One-click updates** | Panel "Update" button + host-side watcher pulls + rebuilds the latest release (`v1.9.3`). |
| 📚 **Examples** | [`examples/`](examples/) ships drop-in scene + game templates so you can fork your own without learning the codebase first. |

---

## Quickstart

> **One command + a wizard.** Since `v1.7`, almost everything is
> configured from a first-run setup wizard in the panel itself.
> The only `.env` value you need before bringing it up is `PUBLIC_URL`.

```bash
git clone https://github.com/cachenetworks/CacheStream.git
cd CacheStream
cp .env.example .env
$EDITOR .env                                 # set PUBLIC_URL (see below)
docker compose up -d
```

Then open `https://your-tunnel-hostname/` → the setup wizard walks
you through Twitch dev-app credentials and login. First login
claims permanent ownership. Click **Start stream** when ready.

### The one required `.env` var

| Var | What | Where to get it |
|---|---|---|
| `PUBLIC_URL` | Your Cloudflare-Tunnel hostname (or `http://localhost:7788` for local dev) | <https://one.dash.cloudflare.com/> → Zero Trust → Networks → Tunnels |

When you create the Twitch dev app (the wizard prompts you to),
set the **OAuth Redirect URL** to `<PUBLIC_URL>/api/auth/twitch/callback`
— exact match, no trailing slash.

**No stream key, no client secret, no session secret in `.env`.**
The wizard collects what it needs and stores it in SQLite; the
broadcaster's stream key is pulled directly from Twitch via the
`channel:read:stream_key` OAuth scope on every login.

`INTERNAL_API_TOKEN` is auto-generated by the web container at
first boot and shared with the streamer over a docker volume.
`SESSION_SECRET` is auto-generated on first request.

Everything else has sensible defaults, including the encoder
profile which auto-tunes to your host.

### Inviting moderators (v1.13)

Owner can mint single-use invite links from the **Staff** tab in
the panel. The invitee opens the URL, logs in with their own
Twitch account, and gets a `MOD` badge in the panel header. Mods
can drive everything except branding, stream-key rotation, host
updates, and staff management.

### Or use the pre-built images (no build step)

```bash
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml up -d
```

Pulls `ghcr.io/nekosuneprojectsforks/cachestream-web`,
`ghcr.io/nekosuneprojectsforks/cachestream-streamer`, and
`ghcr.io/nekosuneprojectsforks/cachestream-ingest`, built multi-arch
(`amd64` + `arm64`) by GitHub Actions. Set `CACHESTREAM_GHCR_OWNER`
to another lowercase owner if you want images from a different fork.
Skips the ~5 minute first-time build.

### Or run it as a desktop app (no Docker) — `v1.14`

Prefer not to run Docker? CacheStream also ships as a native
**desktop app** for **Linux** (x64 + arm64, including Raspberry Pi
OS 64-bit) and **Windows** (x64 + arm64). One installer bundles
everything — Chromium, FFmpeg, the panel, and the streamer — so
there's nothing else to install.

Grab the installer for your platform from the
[Releases page](https://github.com/cachenetworks/CacheStream/releases)
(`.AppImage` / `.deb` for Linux, NSIS installer / portable `.exe`
for Windows), launch it, and the same control panel opens in its own
window. Log in to Twitch, pick a scene, hit **Start**.

It renders scenes through an offscreen **GPU-accelerated** window at a
guaranteed frame rate, so the Pi's choppy-scene problem doesn't apply.
Build it yourself from [`apps/desktop/`](apps/desktop/) — see that
README for the dev + packaging flow.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│   Browser (operator)                                           │
│      https://your-host/admin                                   │
│      Twitch OAuth login, first-login-wins ownership            │
└────────────────────────────────────────────────────────────────┘
                          │  HTTPS
                          ▼
┌────────────────────────────────────────────────────────────────┐
│   Cloudflare Tunnel                                            │
│      (configured in the Cloudflare dashboard)                  │
│      Terminates TLS, forwards to host:7788                     │
└────────────────────────────────────────────────────────────────┘
                          │  plain HTTP, inside the host
                          ▼
┌────────────────────────────────────────────────────────────────┐
│   cachestream-web  ·  Next.js 14 (TypeScript, App Router)      │
│                                                                │
│      /            public landing                               │
│      /admin       control panel (auth-gated)                   │
│      /scene/*     ten built-in scenes + custom scenes          │
│      /widgets/*   chat + alert iframe widgets                  │
│      /api/*       70+ routes (OAuth, streamer RPC, scenes,     │
│                   overlays, schedule, twitch helix, chat IRC,  │
│                   eventsub, music, VODs, games, branding)      │
│                                                                │
│      Long-lived workers: chat IRC, EventSub WS, scheduler,     │
│      Pet game tick, Datacenter game tick, music FFmpeg         │
│                                                                │
│      SQLite (better-sqlite3) at /app/data/cachestream.db       │
└────────────────────────────────────────────────────────────────┘
                          │  HTTP + bearer token
                          │  (internal compose network)
                          ▼
┌────────────────────────────────────────────────────────────────┐
│   cachestream-streamer  ·  Node + Chromium + FFmpeg            │
│                                                                │
│      Headless Chromium (puppeteer-core, --headless=new)        │
│         CDP Page.startScreencast → JPEG frames                 │
│            │                                                   │
│            ▼  binary write into ffmpeg stdin                   │
│      FFmpeg (image2pipe → libx264/HW → AAC → FLV → RTMP)       │
│         + audio FIFO shared with the web container             │
│         + auto-reconnect with exponential backoff              │
│         + thermal monitor (Pi/ARM hosts)                       │
│         + VOD pipeline (file/URL → RTMP, bypasses Chromium)    │
│                                                                │
│      Auto-profile picks encoder + resolution + bitrate per host│
└────────────────────────────────────────────────────────────────┘
                          │  RTMP
                          ▼
                rtmp://live.twitch.tv/app/<key>
```

Two containers, one `.env`, one `docker compose up -d`. The web container
is the only one published to the host; the streamer is internal-only.

---

## Repository layout

```
CacheStream/
├── apps/
│   ├── streamer/                Node + Chromium + FFmpeg worker
│   │   ├── Dockerfile
│   │   ├── entrypoint.sh        Drops root → streamer after fixing volume perms
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.js
│   │       ├── config.js        env vars + auto-profile merge
│   │       ├── autoprofile.js   Pi vs x86 host detection
│   │       ├── thermal.js       CPU temp monitor + auto-throttle
│   │       ├── logger.js
│   │       ├── stream.js        Puppeteer → FFmpeg → RTMP pipeline
│   │       └── api.js           Internal HTTP control API
│   ├── web/                     Next.js 14 + TypeScript
│   │   ├── Dockerfile           Multi-stage standalone build
│   │   ├── entrypoint.sh        Drops root → nextjs after fixing volume perms
│   │   └── src/                 see "Built with" below for the full tree
│   └── desktop/                 Electron desktop app (no Docker) — v1.14
│       ├── src/                 main process, DesktopStreamer, audio relay
│       ├── scripts/             vendor streamer src + build web bundle
│       └── electron-builder.yml win/linux × x64/arm64 installers
├── examples/                    👈 Copy-paste templates for new scenes + games
│   ├── README.md
│   ├── scenes/
│   │   ├── countdown-poster/    Simple full-screen poster + countdown
│   │   ├── now-playing-card/    Music now-playing card you can drop anywhere
│   │   └── chat-leaderboard/    Live top chatters scoreboard
│   └── games/
│       ├── 8ball/               !8ball  — minimal chat-command game
│       └── reaction/            !go     — first to type wins
├── .github/workflows/           CI: build + push images to GHCR on tag
├── docker-compose.yml
├── .env.example
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
└── README.md
```

---

## Setup walkthrough

### 1. Register a Twitch developer application

Go to <https://dev.twitch.tv/console/apps> → **Register Your Application**.

- **Name**: anything (`CacheStream` is fine).
- **OAuth Redirect URL**: `<PUBLIC_URL>/api/auth/twitch/callback` — must
  match `PUBLIC_URL` from your `.env` exactly, including `https://` and
  hostname, with no trailing slash.
- **Category**: Application Integration.
- **Client Type**: Confidential.

Copy the **Client ID** into `TWITCH_CLIENT_ID`. Click **New Secret** and
copy that into `TWITCH_CLIENT_SECRET`. (You can rotate the secret later
without breaking anything.)

### 2. Create a Cloudflare Tunnel (recommended)

In the Cloudflare dashboard:

1. **Zero Trust → Networks → Tunnels** → **Create a tunnel** → name it.
2. Install the connector on your host (the dashboard gives you a one-liner).
3. Under **Public Hostnames** add:
   - Subdomain / Domain: e.g. `stream.example.com`
   - Service: `HTTP`
   - URL: `localhost:7788`
4. That hostname becomes your `PUBLIC_URL=https://stream.example.com`.

You don't need to expose port `7788` publicly — Cloudflare connects
outbound from the tunnel. For defence in depth, bind it to localhost
only in `docker-compose.yml`:

```yaml
ports:
  - "127.0.0.1:7788:7788"
```

### 3. Configure `.env`

```bash
cp .env.example .env
$EDITOR .env
```

The six required vars are listed in the Quickstart. Everything else is
optional — most knobs default to `auto` and tune themselves.

### 4. Bring it up

```bash
docker compose up -d
docker compose logs -f
```

The streamer logs its auto-profile pick on boot:

```text
{"msg":"auto-profile picked","arch":"arm64","cores":4,"ramGB":4,
 "piModel":"Raspberry Pi 4 Model B Rev 1.4","profile":"pi",
 "encoder":"Raspberry Pi V4L2 M2M (HW)","resolution":"1280x720@30",
 "videoBitrateKbps":3500}
```

The web container migrates its SQLite schema on first boot:

```text
[boot] no broadcaster tokens — skipping chat/eventsub startup
[boot] seeded 8 built-in scene presets
```

Open `<PUBLIC_URL>/admin` → **Login with Twitch**.

### 5. Stream

In the panel:

1. Go to **Branding**, upload a logo, set your display name + accent.
2. Go to **Status**, pick a scene (Starting Soon is good for first boot).
3. Click **Start stream**.

Within ~10 seconds Twitch's dashboard at
<https://dashboard.twitch.tv/stream-manager> shows you live.

To swap scenes mid-stream, pick a different preset or use **Studio**
to compose overlays on a draft and **Take → Program** in one click.

---

## Control panel features

The panel has thirteen tabs, each focused on one workflow. Two
(**Branding**, **Staff**) are owner-only; the other eleven are
visible to both the owner and any invited moderator.

### Status
Live stream state, scene URL, uptime, frame count, resolution, bitrate,
ingest endpoint, stream-key presence, codec, **auto-profile category**,
**CPU temp**, last error. Start / Stop / Restart. Scene URL swap. Saved
scene presets (one-click activate, delete). Overlay set library. Minute-
resolution rotation scheduler.

### Studio
Large preview canvas at 1920×1080 with letterboxed auto-fit zoom. Drag
overlays around the canvas, grab the cyan resize handle. Sidebar with
add-layer buttons, layer list, per-layer inspector (text/HTML/source +
X/Y/W/H numeric inputs). Small floating Program (live) thumbnail in the
bottom-right. Optional grid + rule-of-thirds guides. **Take → Program**
atomically switches the live scene and applies the draft overlay set.

### Scenes
Lists all eleven scenes:
- Eight built-ins (Hello World, Starting Soon, BRB, Ending, Offline,
  Music, Pet, Datacenter)
- Five template-based custom scene types (Starting Soon, BRB, Ending,
  Generic, Raw HTML/CSS)

Save built-ins as preset, copy URL, open preview. Author your own with
per-template fields (title / subtitle / accent / countdown ISO / social
handles / raw HTML) and serve at `/scene/custom/<slug>`.

### Stream Info
Edit Twitch broadcaster metadata via Helix: title, category (debounced
search), tags, language. Shows live viewer count when broadcasting.

### Chat
Reads via EventSub `channel.chat.message` over WebSocket (Helix
chat — replaced the old IRC client in `v1.8`). Sends via Helix
`POST /chat/messages`. Live feed via SSE; composer to send as
the broadcaster. Connection-state badges for chat + EventSub.
If your token is missing scopes, one-click re-authorize link.

### Commands / AutoMod
- **Custom commands** — trigger on first word of a message
  (with or without leading `!`). Per-trigger cooldowns, mod-only /
  sub-only flags. Response templating: `{user}`, `{channel}`,
  `{arg1}`…`{args}` plus live-stat variables `{uptime}`,
  `{viewers}`, `{game}`, `{title}`, `{followers}` (`v1.12`) —
  resolved against a 5s Helix snapshot cache.
- **AutoMod rules** — `contains` / `startswith` / `regex` matching;
  actions `delete` / `timeout <s>` / `ban`. Uses the Twitch moderation API.

### Alerts
Live feed of EventSub notifications. Auto-subscribed on connect:
`channel.follow`, `channel.subscribe`, `channel.subscription.gift`,
`channel.subscription.message` (resubs), `channel.cheer`, `channel.raid`.

### Music
- **Upload** MP3/FLAC/OGG/WAV/OPUS up to 200 MB each.
- **Tag parsing** with `music-metadata` — title, artist, album, duration,
  embedded cover art extracted to `<DATA_DIR>/covers/`.
- **Inline edit** for title/artist/album (marked `edited`, never
  overwritten by rescans).
- **Now-playing card** with cover thumbnail.
- **Radio presets** — any Icecast/Shoutcast/direct-stream URL.
- Volume / loop / shuffle.

### VODs
- **Upload** MP4/MOV/MKV/WEBM/M4V up to 4 GB.
- **Remote URLs** for anything FFmpeg can ingest.
- **Per-VOD edit + loop + delete + scan-dir** (pick up files you
  SFTP'd in directly).
- Playing a VOD bypasses Chromium entirely — much lower CPU than
  rendering a `<video>` element.

### Games
- **AI Pet** (`/scene/pet`) — 6 stats, 4 evolution tiers
  (Datablob → Loglurker → Cachewyrm → Stackwraith). Chat-driven
  via `!feed` `!pet` `!play` `!sleep` `!teach <word>` (mod)
  `!insult` `!hit`.
- **Twitch Plays Datacenter** (`/scene/datacenter`) — manage servers,
  power, coolant, uptime under cyberattacks. Chat commands:
  `!add-server` `!defend` `!cool` `!power+` `!invest` `!restart`.

### Sources (v1.11)
External content you can use as scenes:
- **Browser-source embeds** — Streamlabs alert boxes, NightBot
  timers, donation tickers, any URL widget. Rendered in a
  sandboxed iframe so the embed can't read panel cookies.
- **Twitch VOD archive** — pulls your last 20 broadcasts via
  Helix `GET /videos`; one click promotes a VOD to a "rerun"
  scene that plays via the official Twitch embed player.
- **Multi-key RTMP ingest** — additional keys alongside the
  default. Push from OBS / phone / capture card simultaneously,
  switch between them as scenes.

### Branding (owner-only)
Display name, tagline, accent colour with 8 quick-pick swatches
(`v1.10`), logo upload (PNG/JPG/WEBP/SVG/GIF, ≤4 MB), and the
**Scene overlays** toggle card (chat box, alerts ticker, Now
Playing card, uptime badge — per-overlay enable + corner). All
flow into every scene's ribbon, the public landing page, and
the admin header. Inline live preview before saving.

### Staff (owner-only, v1.13)
Mint single-use moderator invite codes with optional expiry
(1 h / 24 h / 7 d / 30 d / never). Copy the URL, share with the
mod, revoke any time. Active moderator list with one-click
revoke.

---

## Bundled scenes

| URL | Description | Query params |
|---|---|---|
| `/scene` | Cyberpunk "Hello World" intro | — |
| `/scene/starting-soon` | Animated standby + optional countdown | `?title=` `?subtitle=` `?accent=` `?bg=` `?at=ISO` `?label=` |
| `/scene/brb` | Be right back / intermission card | `?title=` `?subtitle=` `?accent=` `?bg=` |
| `/scene/ending` | Off-air thank you + social handles | `?title=` `?subtitle=` `?twitch=` `?youtube=` `?twitter=` `?discord=` `?accent=` `?bg=` |
| `/scene/offline` | Neutral idle fallback | `?title=` `?subtitle=` `?accent=` |
| `/scene/music` | Radio scene with cover art + visualiser | — (driven by music engine) |
| `/scene/pet` | AI Pet creature | — (driven by chat) |
| `/scene/datacenter` | NOC dashboard sim | — (driven by chat) |
| `/scene/custom/<slug>` | Your custom scene | (set per template in the editor) |

Every scene uses the same `SceneFrame` shell, so the **branding ribbon**
(logo + display name) and **accent colour** show up consistently across
all of them.

---

## Make your own scenes + games

See the [`examples/`](examples/) directory.

**Three scene templates** you can copy into a custom scene
(Scenes tab → New custom scene → Raw HTML/CSS) and tweak:

| Folder | What it shows | Difficulty |
|---|---|---|
| [`examples/scenes/countdown-poster/`](examples/scenes/countdown-poster/) | Full-screen poster with title + image + countdown | ⭐ |
| [`examples/scenes/now-playing-card/`](examples/scenes/now-playing-card/) | Music now-playing card you can drop on any scene | ⭐⭐ |
| [`examples/scenes/chat-leaderboard/`](examples/scenes/chat-leaderboard/) | Live top chatters scoreboard via SSE | ⭐⭐⭐ |

**Two game templates** you can fork into new `apps/web/src/lib/games/*.ts`
modules:

| Folder | What it shows | Difficulty |
|---|---|---|
| [`examples/games/8ball/`](examples/games/8ball/) | Minimal command-response game with the chat bus | ⭐ |
| [`examples/games/reaction/`](examples/games/reaction/) | First-to-type-wins reaction game with a tick loop, SSE state stream, and scoreboard scene | ⭐⭐⭐ |

Each example is heavily commented and self-contained. Walk through
[`examples/README.md`](examples/README.md) for the full guide.

---

## API reference

All `/api/*` routes other than `/api/health`, `/api/auth/twitch/*`,
and the SSE / now-playing / scene-data endpoints require an owner
session cookie.

### Auth
| Method | Path | Effect |
|---|---|---|
| `GET`  | `/api/health` | Liveness |
| `GET`  | `/api/auth/twitch/login` | 302 to Twitch |
| `GET`  | `/api/auth/twitch/callback` | Issue session + persist tokens |
| `POST` | `/api/auth/logout` | Destroy session |

### Stream control
| Method | Path | Body |
|---|---|---|
| `GET`  | `/api/stream/status` | — |
| `POST` | `/api/stream/{start,stop,restart}` | — |
| `POST` | `/api/stream/scene` | `{ url }` |

### Scene presets + custom scenes
| Method | Path | Body |
|---|---|---|
| `GET/POST/DELETE` | `/api/scenes[/:id[/activate]]` | name+url / — |
| `GET/POST` | `/api/scenes/custom` | `{ name, template, slug?, config }` |
| `GET/PATCH/DELETE` | `/api/scenes/custom/:id` | partial of above |

### Overlays + schedule
| Method | Path | Body |
|---|---|---|
| `GET/POST/DELETE` | `/api/overlays[/:id[/activate]]` | name + overlay array |
| `PATCH` | `/api/overlays/:id/update` | `{ overlays: [...] }` |
| `POST` | `/api/overlays/clear` | — |
| `GET/POST/PATCH/DELETE` | `/api/schedule[/:id]` | scene+overlay+time+days |

### Twitch broadcaster
| Method | Path | Body |
|---|---|---|
| `GET/PATCH` | `/api/twitch/channel` | `{ title?, game_id?, tags?, broadcaster_language? }` |
| `GET` | `/api/twitch/categories/search?q=` | — |

### Chat + alerts
| Method | Path | Body |
|---|---|---|
| `GET/POST` | `/api/chat/status` | `{ action: "start"\|"stop" }` |
| `POST` | `/api/chat/send` | `{ text }` |
| `GET`  | `/api/chat/log?limit=N` | — |
| `GET`  | `/api/chat/stream` | SSE chat feed (public — overlays use it) |
| `GET`  | `/api/alerts/stream` | SSE EventSub feed |

### Commands + AutoMod
| Method | Path | Body |
|---|---|---|
| `GET/POST/PATCH/DELETE` | `/api/commands[/:id]` | trigger / response / cooldown / flags |
| `GET/POST/PATCH/DELETE` | `/api/automod[/:id]` | pattern / matchType / action / duration |

### Music
| Method | Path | Body |
|---|---|---|
| `GET`  | `/api/music/status` | — |
| `GET/POST` | `/api/music/library` | rescan |
| `PATCH/DELETE` | `/api/music/library/:id` | inline edit + delete file |
| `POST` | `/api/music/upload` | multipart |
| `GET`  | `/api/music/file/:id` | raw audio (public — visualiser uses it) |
| `GET`  | `/api/music/cover/:id` | extracted cover art (public) |
| `POST` | `/api/music/play` | `{ trackId }` |
| `POST` | `/api/music/{next,stop}` | — |
| `POST` | `/api/music/volume` | `{ value: 0..1 }` |
| `POST` | `/api/music/mode` | `{ loop?, shuffle? }` |
| `GET/POST` | `/api/music/radio` | `{ url, name? }` / `{ presetId }` |
| `DELETE` | `/api/music/radio/:id` | — |
| `GET`  | `/api/music/now` | public now-playing snapshot |

### VODs
| Method | Path | Body |
|---|---|---|
| `GET/POST` | `/api/vods` | `{ name, kind, pathOrUrl, loop? }` |
| `PATCH/DELETE` | `/api/vods/:id` | partial / — |
| `POST` | `/api/vods/upload` | multipart |
| `POST` | `/api/vods/scan` | re-scan `./media/vods` |
| `POST` | `/api/vods/:id/play` | — |
| `POST` | `/api/vods/stop` | return to scene |

### Games
| Method | Path | Body |
|---|---|---|
| `GET`  | `/api/games/pet/state` | public snapshot |
| `GET`  | `/api/games/pet/stream` | SSE |
| `POST` | `/api/games/pet/rename` | `{ name }` |
| `POST` | `/api/games/pet/reset` | — |
| `GET`  | `/api/games/datacenter/state` | public snapshot |
| `GET`  | `/api/games/datacenter/stream` | SSE |
| `POST` | `/api/games/datacenter/reset` | — |

### Branding
| Method | Path | Body |
|---|---|---|
| `GET` | `/api/branding` | public — scenes need it |
| `PATCH` | `/api/branding` | `{ displayName?, tagline?, accent? }` |
| `GET` | `/api/branding/logo` | public binary stream |
| `POST` | `/api/branding/logo` | multipart |
| `DELETE` | `/api/branding/logo` | — |

The streamer's internal API on port `7789` (`/start`, `/stop`, `/scene`,
`/overlays`, `/vod/play`, `/vod/stop`, `/status`, `/health`) is **not**
exposed to the host. Only the web container talks to it, with a bearer
token from `INTERNAL_API_TOKEN`.

---

## Auto-adaptive CPU profile

`STREAM_PROFILE=auto` (the default) detects the host on boot:

| Host signature | Picked profile | Codec choice |
|---|---|---|
| Raspberry Pi (any) | 720p30, ~2.8–3.5 Mbps | `h264_v4l2m2m` (HW) → libx264 ultrafast |
| Weak ARM, ≤4 cores or ≤4 GB RAM | 720p30, 3.0 Mbps | libx264 ultrafast |
| 1–2 core x86 | 720p30, 3.5 Mbps | libx264 veryfast |
| 4–8 core x86 | 1080p30, 4.5 Mbps | libx264 veryfast (zerolatency) |
| 12+ core x86 | 1080p60, 6.0 Mbps | libx264 medium (no zerolatency) |

In auto mode the profile **wins** over individual `STREAM_*` env vars so
stale values in an old `.env` don't sabotage tuning. To override a
single knob:

```dotenv
STREAM_PROFILE=manual
STREAM_WIDTH=1280
STREAM_HEIGHT=720
# … fill in everything else explicitly
```

### Hardware encoders

Auto-detected via `ffmpeg -encoders` at boot. Preference order:

1. `h264_v4l2m2m` — Raspberry Pi VC4 HW encoder
2. `h264_nvenc` — NVIDIA
3. `h264_qsv` — Intel Quick Sync
4. `h264_videotoolbox` — macOS hosts via Docker Desktop
5. `libx264` — software fallback

Force a specific codec with `STREAM_VIDEO_CODEC=libx264`.

### Thermal monitor

On hosts that expose `/sys/class/thermal/thermal_zone0/temp` (Pi,
most Linux servers):

- Crosses `STREAM_THERMAL_THROTTLE_C` (default 80 °C) → hot-restart
  with a thermal-safe profile (720p / lower bitrate / `ultrafast`).
- Falls below `STREAM_THERMAL_RECOVER_C` (default 68 °C) → restore.

Twitch sees a quick RTMP reconnect; the broadcast doesn't fully drop.
The Status tab shows the live temperature and a red badge when throttled.

---

## CPU optimisation knobs

For finer-grained control beyond what the auto-profile picks.

### Encoder (highest impact)
| Knob | Effect |
|---|---|
| `STREAM_PRESET=ultrafast` | Biggest single drop. Visible quality loss on detailed scenes, fine for dashboards. |
| `STREAM_X264_THREADS=2` | Pin x264 to 2 cores so chat / music / EventSub don't get starved. |
| `STREAM_X264_TUNE=` (empty) | Re-enables x264 lookahead. ~150 ms more latency, but better quality at the same bitrate. |
| `STREAM_VIDEO_CODEC=h264_v4l2m2m` | Force Pi hardware encoder. |

### Resolution / FPS
| Combination | CPU impact |
|---|---|
| 1080p30 | baseline |
| 720p30 | ~55 % less encoder work |
| 1080p15 | ~50 % less encoder work |
| `STREAM_CAPTURE_EVERY_NTH=2` | Halves Chromium → FFmpeg JPEG decode load on 60fps scenes |

### Capture
- `STREAM_SCREENCAST_QUALITY=60` — drops JPEG quality on the
  Chromium → FFmpeg pipe. Visually identical after H.264.
- `STREAM_CHROMIUM_GPU=auto` (default) — lets Chromium rasterise
  scenes on the GPU instead of the CPU software compositor. The
  screencast is paint-driven, so on a Pi the software path caps the
  scene at **~3 fps** no matter the encoder settings. `auto` turns
  the GPU on for a Pi (or any host with a `/dev/dri` render node);
  you must pass `/dev/dri` into the streamer container — the Pi
  overlay (`docker-compose.pi.yml`) now does this. Separate from the
  HW encoder, so it also speeds up the Pi 5. Set `off` for the old
  software path.

### Scene-side
- Avoid `filter: blur(40px)`, full-screen `backdrop-filter`, or
  `box-shadow: 0 0 200px` — each forces an extra fullscreen
  composited layer per frame.
- Animate with `transform` and `opacity`, not `top`/`left`/`width`.

### "Low-CPU preset" for the Pi
```dotenv
STREAM_PROFILE=manual
STREAM_WIDTH=1280
STREAM_HEIGHT=720
STREAM_FPS=24
STREAM_VIDEO_BITRATE=2500
STREAM_VIDEO_MAXRATE=2500
STREAM_VIDEO_BUFSIZE=5000
STREAM_PRESET=ultrafast
STREAM_X264_THREADS=2
STREAM_SCREENCAST_QUALITY=55
```

---

## Troubleshooting

### Login → 400 Redirect URI mismatch
The OAuth Redirect URL registered at <https://dev.twitch.tv/console/apps>
must match `<PUBLIC_URL>/api/auth/twitch/callback` *exactly* — no
trailing slash, exact hostname, exact `http` vs `https`.

### Login succeeds but "claimed by another account"
First-login-wins fired before you. Options:
1. **Reclaim**: stop the stack, delete the data volume
   (`docker volume rm cachestream_cachestream-data`), log in immediately.
2. **Pre-seed**: set `INITIAL_OWNER_LOGIN=yourtwitchlogin` (lowercase)
   in `.env` before next boot.

### `mkfifo: Permission denied` / FFmpeg reconnect loop
Fixed in v1.6 via the new entrypoint scripts. If you still see it,
rebuild the images: `docker compose build --no-cache && docker compose up -d`.

### Stream starts then drops after 30 s
Twitch dropped you for missing audio. Check
`docker compose logs streamer | grep ffmpeg` — if audio is missing,
the silence filler in the web container failed to start. Check
`docker compose logs web | grep "silence filler"`.

### Stream reconnects in a loop
Almost always a wrong `TWITCH_STREAM_KEY` or a host blocking outbound
TCP/1935. Test from the host:
```bash
nc -zv live.twitch.tv 1935
```

### "OAuth state mismatch"
Stale state cookie or `SESSION_SECRET` changed mid-flow. Restart the
login. If persistent, the browser may be blocking third-party cookies
on the Cloudflare hostname.

### Pi scenes look choppy / stuck around 3 FPS
The Chromium screencast only emits a frame when the page repaints,
and the CPU software compositor on a Pi can't repaint the animated
scenes faster than a few times a second — so the broadcast looks
like a ~3-fps slideshow even though FFmpeg pads it to 30 fps CFR.
Fix: let Chromium use the GPU.
- Confirm `STREAM_CHROMIUM_GPU` is `auto` (default) or `on`.
- Pass the GPU render node into the container. **Pi 4:**
  `docker compose -f docker-compose.yml -f docker-compose.pi.yml up -d`
  (the overlay now maps `/dev/dri` alongside the v4l2 encoder).
  **Pi 5:** map just `/dev/dri` (see the Pi 5 note at the top of
  `docker-compose.pi.yml`).
- The streamer's boot log should show `gpu: on (egl, …)`.
- Still avoid `backdrop-filter: blur`, full-screen `box-shadow`, and
  giant blurs in custom scenes — they're expensive even on the GPU.

### Pi runs hot
- Confirm the auto-profile picked `pi` and (if available) `h264_v4l2m2m`
  in the Status tab.
- Bump the case airflow (a $5 fan helps).
- If still hot, ship the "Low-CPU preset" above.
- The thermal monitor will hot-restart to 720p if it crosses 80 °C; you
  can lower the throttle threshold with `STREAM_THERMAL_THROTTLE_C=70`.

### Cloudflare Tunnel upload size limit
Uploads >100 MB may fail on the Cloudflare free plan. For big VODs,
SFTP them straight into `./media/vods/` on the host and click
**Scan dir** in the VODs tab.

---

## Security

- The control panel sits behind Cloudflare Tunnel by default, so port
  `7788` doesn't need to be open to the public internet. Bind to
  `127.0.0.1:7788:7788` in `docker-compose.yml` for an extra layer.
- **Stream key + OAuth secret + session secret + internal API token**
  all live in `.env` and inside the containers. They never reach the
  browser. `.env` is in `.gitignore`.
- **Sessions are HMAC-signed cookies** (`SESSION_SECRET`). Rotating
  that value logs every session out — useful if you suspect a leak.
- The **streamer's HTTP API** requires a bearer token on every endpoint
  except `/health`. Even if someone reached `streamer:7789` via a
  container escape, they couldn't operate the stream without that
  token.
- **First-login-wins** is convenient but means a public tunnel can be
  claimed by anyone who finds the URL between deploy and login.
  Pre-seed `INITIAL_OWNER_LOGIN` to close that window.
- The **raw-HTML custom scene** is owner-only. The HTML inside is
  rendered verbatim in the headless browser. Be careful about pasting
  third-party HTML you don't trust — it can `fetch()` arbitrary URLs
  from inside your network.

Found a security issue? See [SECURITY.md](SECURITY.md).

---

## Long-stream operations (v1.13.3+)

CacheStream is designed to stay healthy through multi-day
broadcasts. Several safety nets ensure a single hiccup doesn't
take down the stream and quietly fail to recover:

| Knob | Default | What it does |
|---|---|---|
| `STREAM_WATCHDOG_TIMEOUT_SECONDS` | `30` | If `state=running` but no MJPEG frames have flowed to FFmpeg in this many seconds, force a reconnect. Catches TCP-idle drops on the RTMP push, dead CDP screencast sessions, and similar silent-death modes. `0` disables. |
| `STREAM_BROWSER_RECYCLE_HOURS` | `6` | Proactively tear down + restart the Chromium + FFmpeg pipeline after this much healthy uptime. Defends against gradual Chromium memory bloat. `0` disables. |
| `STREAM_MEMORY_RECYCLE_LIMIT_MB` | `1500` | If the streamer process RSS exceeds this many megabytes, force an immediate pipeline recycle. Catches fast leaks before the host OOM-kills the container. `0` disables. |
| `STREAM_TEARDOWN_TIMEOUT_SECONDS` | `10` | Hard deadline for `_teardown()`. If `browser.close()` or anything else hangs past this, leftover processes get `SIGKILL`'d and the next reconnect cycle proceeds anyway. |

The streamer's `/status` endpoint (polled by the panel every
5 s) now reports `framesDropped`, `memory.rssMB`,
`memory.heapUsedMB`, and `stdinBufferedKB` so you can see
backpressure or leak buildup from the Status tab before it
becomes a problem (`v1.13.5`).

The web container exposes the same telemetry at
`GET /api/system/diag` (owner / mod only) alongside live bus
listener counts per topic.

---

## Built with

- [Next.js 14](https://nextjs.org/) (App Router, TypeScript, standalone output)
- [puppeteer-core](https://github.com/puppeteer/puppeteer) + [Chromium](https://www.chromium.org/) (headless rendering)
- [FFmpeg](https://ffmpeg.org/) (H.264 encoding, RTMP push, music mixing)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (persistence)
- [music-metadata](https://github.com/Borewit/music-metadata) (ID3/Vorbis/FLAC tags)
- [ws](https://github.com/websockets/ws) (Twitch EventSub WebSocket)
- [hls.js](https://github.com/video-dev/hls.js) (RTMP-ingest playback in headless Chromium)
- [nginx-rtmp](https://github.com/arut/nginx-rtmp-module) (RTMP ingest + HLS transmux sidecar)
- [pino](https://getpino.io/) (structured logging)

No client-side React state management library, no UI kit, no Tailwind —
the panel is hand-rolled CSS modules with CSS custom properties for
theming. The cyberpunk aesthetic is 100 % CSS animations + radial
gradients, no images.

---

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the
house style. Quick start:

- Run the local build: `cd apps/web && npm install && npm run build`.
- Test the streamer locally: `cd apps/streamer && npm install && node src/index.js`
  (you'll need `INTERNAL_API_TOKEN` and a stream key in your env).
- Keep the architecture: web is stateless beyond the SQLite/branding
  volume; streamer is the only place that should touch FFmpeg or
  Chromium.

---

## License

[MIT](LICENSE) — do what you want, just don't sue me.

---

<div align="center">

**Made for late-night dashboard streams and lo-fi radio.**

<sub>If this saved you from setting up OBS, ⭐ the repo.</sub>

</div>
