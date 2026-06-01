/**
 * Centralised, validated runtime config for the web app.
 *
 * Loaded once at module init. Throws synchronously on missing
 * required vars so a misconfigured deploy fails fast rather
 * than silently misbehaving in OAuth.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `Missing required env var: ${name}. Copy .env.example to .env.`
    );
  }
  return v.trim();
}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function toBool(value: string | undefined, fallback = false): boolean {
  if (value == null) return fallback;
  const s = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

// At build time inside the Docker `builder` stage we don't
// have a real .env, so we relax validation for `next build`.
// All access happens at request time anyway.
const buildPhase = process.env.NEXT_PHASE === "phase-production-build";

function safeRequired(name: string, fallback: string): string {
  if (buildPhase) return process.env[name]?.trim() || fallback;
  return required(name);
}

const port = Number.parseInt(process.env.WEB_PORT || "7788", 10);
const publicUrl = (optional("PUBLIC_URL", `http://localhost:${port}`)).replace(
  /\/+$/,
  ""
);

// OAuth scopes — declared once, used by buildAuthorizeUrl + the
// missing-scopes detector. Kept at module scope so it can be
// imported without going through the dynamic resolver below.
export const OAUTH_SCOPES = [
  "user:read:email",
  "channel:manage:broadcast",
  "channel:read:subscriptions",
  // Lets the panel fetch the broadcaster's current stream key
  // from Helix (GET /streams/key) — kills the manual paste-from-
  // dashboard workflow that has been a recurring source of
  // "Twitch is OFFLINE" bugs (stale .env, wrong key, etc.).
  "channel:read:stream_key",
  "bits:read",
  "moderation:read",
  "moderator:manage:banned_users",
  "moderator:manage:chat_messages",
  "moderator:read:followers",
  // Helix chat scopes — replace the legacy IRC scopes (chat:read +
  // chat:edit). v1.8.0 moved chat off IRC over WebSocket onto
  // EventSub (channel.chat.message) + Helix (POST /chat/messages).
  // Kept the legacy scopes alongside for now so a user who's mid-
  // migration with an old token still has working chat until they
  // re-login; the missing-scopes detector pulls them in.
  "user:bot",
  "user:read:chat",
  "user:write:chat",
  "chat:read",
  "chat:edit",
] as const;

/**
 * OAuth credentials are now wizard-managed (stored in SQLite kv).
 * Reading them happens at REQUEST time, not module-load time, so
 * a fresh wizard save is picked up immediately by any subsequent
 * OAuth / Helix call without restarting the container.
 *
 * Use this in route handlers instead of `config.oauth`.
 */
export function oauthSettings() {
  // Lazy import: settings.ts opens the SQLite db on first import,
  // and we don't want config.ts (loaded at boot) to touch the db
  // before instrumentation.ts has had a chance to run migrations.
  const { getSetting, getOrCreateSessionSecret } = require("./settings") as
    typeof import("./settings");
  return {
    clientId:      getSetting("twitch_client_id"),
    clientSecret:  getSetting("twitch_client_secret"),
    sessionSecret: getOrCreateSessionSecret(),
    redirectUri:   `${publicUrl}/api/auth/twitch/callback`,
    scopes:        OAUTH_SCOPES as unknown as string[],
    initialOwnerLogin: optional("INITIAL_OWNER_LOGIN").toLowerCase() || null,
  };
}

export const config = {
  web: {
    port,
    publicUrl,
    trustProxy: toBool(process.env.TRUST_PROXY, false),
  },
  /**
   * @deprecated — prefer `oauthSettings()`. Kept for the few callers
   * that still read static config at module load time (Cookie HMAC
   * keys, etc.); they get the kv value via the same fallback.
   *
   * Note: this getter still uses the lazy require, so it works for
   * pre-wizard deployments where kv may not yet exist (the wizard
   * generates SESSION_SECRET on first read).
   */
  get oauth() { return oauthSettings(); },
  streamer: {
    url: optional("STREAMER_URL", "http://streamer:7789").replace(/\/+$/, ""),
    token: safeRequired("INTERNAL_API_TOKEN", "build-placeholder"),
  },
  scene: {
    defaultUrl: optional("DEFAULT_SCENE_URL", `http://localhost:${port}/scene`),
  },
  runtime: {
    dataDir: optional("DATA_DIR", "data"),
    logLevel: optional("LOG_LEVEL", "info"),
  },
  music: {
    // Path inside the web container where MP3/OGG/FLAC live.
    // Compose mounts ./media/music here from the host.
    libraryDir: optional("MUSIC_LIBRARY_DIR", "/app/media/music"),
  },
  audio: {
    // How the music engine hands PCM to the streamer's FFmpeg.
    //
    //   "fifo" (default) — Docker / Linux. Two named FIFOs on the
    //          shared volume (silence + music), created with mkfifo.
    //          Byte-identical to all prior releases.
    //   "tcp"  — the Electron desktop app. There is no mkfifo on
    //          Windows and no shared volume, so the per-track music
    //          FFmpeg connects to a local TCP relay instead; the
    //          desktop app's relay provides the always-on silent
    //          carrier (so the silence/music fillers are skipped).
    transport: (optional("AUDIO_TRANSPORT", "fifo") === "tcp" ? "tcp" : "fifo") as
      "fifo" | "tcp",
    silenceFifo: optional("SILENCE_FIFO_PATH", "/app/audio/silence.fifo"),
    musicFifo:   optional("MUSIC_FIFO_PATH",   "/app/audio/music.fifo"),
    // TCP-transport target the per-track music FFmpeg connects to.
    musicTcpPort: Number.parseInt(optional("MUSIC_TCP_PORT", "7790"), 10),
    // Bundled FFmpeg path for the desktop build (no ffmpeg on PATH
    // on Windows). Empty → use the PATH `ffmpeg`, as in Docker.
    ffmpegPath: optional("FFMPEG_PATH", "ffmpeg"),
  },
  vods: {
    // Path inside the web container where VOD video files live.
    // Compose mounts ./media/vods here from the host (read-write
    // on web, read-only on streamer).
    libraryDir: optional("VOD_LIBRARY_DIR", "/app/media/vods"),
  },
} as const;

export type Config = typeof config;
