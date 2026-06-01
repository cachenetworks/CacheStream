/**
 * Music engine (web container side).
 *
 * Spawns an FFmpeg process that produces a continuous stream of
 * PCM s16le stereo @ 44.1 kHz into a named FIFO. The streamer
 * container reads the same FIFO as its audio input.
 *
 *   ┌───────────────────────┐        ┌────────────┐
 *   │  music FFmpeg (web)   │ writes │  audio     │ reads
 *   │  source: file | radio │ ─────▶ │  FIFO      │ ────▶ streamer FFmpeg
 *   │  loudnorm filter      │        │ /app/audio │
 *   └───────────────────────┘        └────────────┘
 *
 * The streamer's main FFmpeg consumes the FIFO as a raw PCM input
 * (`-f s16le -ar 44100 -ac 2 -i <fifo>`) and AAC-encodes it for
 * the RTMP output. This lets the music change without ever
 * dropping the video stream.
 *
 * If the music engine isn't running OR no track/radio is queued,
 * the streamer's FFmpeg falls back to its built-in silent
 * anullsrc input (see apps/streamer/src/stream.js) so the
 * broadcast still has the required audio track.
 *
 * State (`mode`, `volume`, `queue`, etc.) is kept in memory plus
 * the kv table so it survives restarts.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { config } from "./config";
import { getStore, type MusicTrack } from "./store";
import { kvGet, kvSet } from "./db";

// Two FIFOs, both always-open from the streamer's read side:
//
//   silence.fifo  ← constant silent PCM written by the always-on filler.
//                   Acts as the "carrier" so amix never sees both inputs
//                   absent at the same instant.
//   music.fifo    ← real music PCM written by a per-track ffmpeg, only
//                   when something is playing. When nothing's playing
//                   the FIFO simply has no writer; amix's
//                   dropout_transition=0 falls back to the silence
//                   carrier with zero glitch.
//
// Why two FIFOs? In v1.5 we used a single FIFO and toggled which
// ffmpeg wrote to it. Even a millisecond gap during the handoff was
// enough for the streamer's main ffmpeg to mark the audio track as
// ended; Twitch then dropped the connection. With two parallel FIFOs
// + amix dropout_transition=0, the music writer can come and go
// without ever interrupting the audio stream the streamer is reading.
const SILENCE_FIFO = config.audio.silenceFifo;
const MUSIC_FIFO   = config.audio.musicFifo;
const AUDIO_FORMAT = ["-f", "s16le", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2"];

// Audio transport (see config.audio). In "tcp" mode (Electron
// desktop) the per-track FFmpeg connects to a local relay instead
// of writing a FIFO, and the relay — not these fillers — provides
// the always-on silent carrier, so we skip the filler machinery
// and the mkfifo calls entirely.
const TCP = config.audio.transport === "tcp";
const FF  = config.audio.ffmpegPath || "ffmpeg";
// Where the per-track music FFmpeg sends PCM in tcp mode.
const MUSIC_SINK = TCP ? `tcp://127.0.0.1:${config.audio.musicTcpPort}` : MUSIC_FIFO;

export type Mode = "idle" | "library" | "radio";

interface NowPlaying {
  trackId?: string;
  title?: string;
  artist?: string;
  album?: string;
  coverPath?: string | null;
  durationS?: number | null;
  url?: string;
  startedAt?: number;
}

interface MusicStatus {
  mode: Mode;
  volume: number;
  loop: boolean;
  shuffle: boolean;
  queue: MusicTrack[];
  nowPlaying: NowPlaying | null;
  fifoReady: boolean;
  lastError: string | null;
}

class MusicEngine {
  private ffmpeg: ChildProcess | null = null;
  /**
   * Second silent-PCM writer, dedicated to music.fifo. Runs
   * whenever there's no real music track playing.
   *
   * Why this exists (separate from the silence.fifo filler):
   *   The streamer's main ffmpeg opens BOTH fifos O_RDONLY. The
   *   open blocks until a writer exists. silence.fifo always has
   *   one (the main `filler`), but music.fifo only had a writer
   *   while a track was playing. On a fresh start with nothing
   *   queued, the streamer's ffmpeg hung forever on
   *   open(music.fifo) and never reached the encode/RTMP stage.
   *
   *   This music-side filler guarantees music.fifo always has
   *   a writer. When a real track is queued, we kill the filler
   *   so the track's ffmpeg can take over the writer side; when
   *   the track ends, the filler resumes. The streamer's amix
   *   with dropout_transition=0 masks the brief sub-100ms gap
   *   during the handoff.
   */
  private musicFiller: ChildProcess | null = null;
  /** True while a real track is intentionally writing to music.fifo. */
  private musicFillerSuspended = false;
  /**
   * Background "silence filler" FFmpeg. Always writes silent PCM
   * into the FIFO whenever there's no real music playing.
   *
   * Why this exists:
   *   The streamer's main FFmpeg opens the FIFO for read. If no
   *   process is writing to the other side, FFmpeg blocks on open
   *   indefinitely — or if it gets interrupted, exits 1 (which
   *   was the symptom we saw on the Pi). Having a continuous
   *   writer guarantees the FIFO is always readable; the music
   *   subsystem just takes over briefly when a track is queued
   *   then hands back to the filler.
   *
   * Cost: anullsrc + raw s16le copy is essentially free
   * (~0.1% of one core).
   */
  private filler: ChildProcess | null = null;
  private mode: Mode = "idle";
  private volume = 0.6;
  private loop = true;
  private shuffle = false;
  private queue: MusicTrack[] = [];
  private nowPlaying: NowPlaying | null = null;
  private currentRadioUrl: string | null = null;
  private lastError: string | null = null;

  constructor() {
    this.volume = clamp01(Number(kvGet("music_volume") ?? "0.6"));
    this.loop  = kvGet("music_loop") !== "0";
    this.shuffle = kvGet("music_shuffle") === "1";
    // Boot both fillers immediately so BOTH fifos have a writer
    // the moment the streamer's main FFmpeg tries to open them.
    // Without the music-side filler, the streamer's ffmpeg hangs
    // on open(music.fifo) when nothing is queued.
    //
    // In tcp mode (desktop) the relay supplies the always-on silent
    // carrier, so there's nothing to fill here — the per-track
    // FFmpeg simply connects to the relay when a track plays.
    if (!TCP) {
      this._startSilenceFiller();
      this._startMusicFiller();
    }
  }

  status(): MusicStatus {
    return {
      mode: this.mode,
      volume: this.volume,
      loop: this.loop,
      shuffle: this.shuffle,
      queue: [...this.queue],
      nowPlaying: this.nowPlaying,
      fifoReady: this._ensureFifoSilently(),
      lastError: this.lastError,
    };
  }

  // ---- Library scan ----------------------------------------------

  async scanLibrary(): Promise<MusicTrack[]> {
    const dir = config.music.libraryDir;
    const out: MusicTrack[] = [];
    const exts = new Set([".mp3", ".m4a", ".ogg", ".oga", ".flac", ".wav", ".opus"]);
    try {
      const stat = fs.statSync(dir);
      if (!stat.isDirectory()) return [];
    } catch { return []; }

    // Lazy-load music-metadata. Surface the failure to the panel
    // (lastError) so users notice if their scans are filename-only
    // because of a missing dep — silent fallback used to mean
    // "library full of [ABCDEF123]-style filenames forever".
    let parseFile: ((file: string) => Promise<any>) | null = null;
    try {
      const mm = await import("music-metadata");
      parseFile = (file) => mm.parseFile(file, { skipCovers: false, duration: true });
    } catch (err: any) {
      const msg = `music-metadata unavailable — scans are filename-only. (${err?.message || err})`;
      console.warn("[music]", msg);
      this.lastError = msg;
    }

    const coversDir = path.join(config.runtime.dataDir, "covers");
    fs.mkdirSync(coversDir, { recursive: true });

    const files: string[] = [];
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && exts.has(path.extname(entry.name).toLowerCase())) {
          files.push(full);
        }
      }
    };
    walk(dir);

    for (const full of files) {
      const relPath = path.relative(dir, full);
      const id = crypto.createHash("sha1").update(relPath).digest("hex").slice(0, 16);

      // Preserve manually-edited metadata across rescans.
      const existing = getStore().getMusicTrack(id);
      if (existing?.manual) {
        out.push(existing);
        continue;
      }

      let title: string | null = path.basename(full, path.extname(full));
      let artist: string | null = null;
      let album: string | null = null;
      let durationS: number | null = null;
      let coverPath: string | null = existing?.coverPath || null;

      if (parseFile) {
        try {
          const meta = await parseFile(full);
          title  = meta.common.title  || title;
          artist = meta.common.artist || meta.common.artists?.[0] || null;
          album  = meta.common.album  || null;
          if (meta.format?.duration) durationS = Math.round(meta.format.duration);

          const picture = meta.common.picture?.[0];
          if (picture && !coverPath) {
            const ext = (picture.format || "image/jpeg").split("/")[1] || "jpg";
            const file = path.join(coversDir, `${id}.${ext}`);
            fs.writeFileSync(file, picture.data);
            coverPath = file;
          }
        } catch (err) {
          // Tag parse failed; keep filename fallback.
        }
      }

      const track = getStore().upsertMusicTrack({
        id, path: relPath,
        title, artist, album, durationS, coverPath,
        manual: false,
      });
      out.push(track);
    }

    // Prune rows for files that no longer exist on disk. Without
    // this, deleting files from the library directory left ghost
    // entries in the panel forever — the library would only ever
    // grow. Manually-edited tracks (manual: true) are also pruned;
    // if the user wants to keep them, they need to keep the file.
    const presentIds = new Set(out.map((t) => t.id));
    const allRows = getStore().listMusicTracks();
    let pruned = 0;
    for (const row of allRows) {
      if (!presentIds.has(row.id)) {
        getStore().removeMusicTrack(row.id);
        pruned++;
      }
    }
    if (pruned > 0) console.log(`[music] scan pruned ${pruned} missing track(s)`);

    return out;
  }

  // ---- Queue + controls ------------------------------------------

  enqueue(trackId: string): void {
    const all = getStore().listMusicTracks();
    const t = all.find((x) => x.id === trackId);
    if (!t) throw new Error("track not found");
    this.queue.push(t);
    if (this.mode === "idle") this._playNextLibraryTrack();
  }

  clearQueue(): void { this.queue = []; }

  next(): void {
    if (this.mode === "library") this._playNextLibraryTrack();
  }

  stop(): void {
    this.mode = "idle";
    this.currentRadioUrl = null;
    this.nowPlaying = null;
    this._killFfmpeg();
    // Silence filler keeps running on its dedicated FIFO — no
    // restart needed. The streamer's amix just stops mixing in
    // music and the broadcast continues silent.
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    kvSet("music_volume", String(this.volume));
    // Re-apply by restarting current source (libx264-style hot-volume isn't
    // possible with a one-shot input; a tiny restart is acceptable).
    this._restartCurrent();
  }

  setLoop(loop: boolean): void { this.loop = loop; kvSet("music_loop", loop ? "1" : "0"); }
  setShuffle(s: boolean): void { this.shuffle = s; kvSet("music_shuffle", s ? "1" : "0"); }

  // ---- Radio -----------------------------------------------------

  playRadio(url: string): void {
    if (!/^https?:\/\//.test(url)) throw new Error("radio url must be http(s)");
    this.currentRadioUrl = url;
    this.mode = "radio";
    this.queue = [];
    this.nowPlaying = { url, startedAt: Date.now() };
    this._spawnFfmpegForInput(["-i", url]);
  }

  // ---- Internals -------------------------------------------------

  private _playNextLibraryTrack(): void {
    if (this.queue.length === 0) {
      // If looping and the library has tracks, refill from the library.
      if (this.loop) {
        const all = getStore().listMusicTracks();
        if (all.length === 0) { this.stop(); return; }
        this.queue = this.shuffle ? shuffle(all) : all;
      } else {
        this.stop();
        return;
      }
    }
    const track = this.queue.shift()!;
    this.mode = "library";
    this.nowPlaying = {
      trackId: track.id,
      title:  track.title  || track.path,
      artist: track.artist || undefined,
      album:  track.album  || undefined,
      coverPath: track.coverPath || null,
      durationS: track.durationS || null,
      startedAt: Date.now(),
    };
    const full = path.join(config.music.libraryDir, track.path);
    this._spawnFfmpegForInput(["-i", full], () => {
      // On natural EOF, advance to the next track.
      if (this.mode === "library") this._playNextLibraryTrack();
    });
  }

  private _restartCurrent(): void {
    if (this.mode === "radio" && this.currentRadioUrl) this.playRadio(this.currentRadioUrl);
    else if (this.mode === "library" && this.nowPlaying?.trackId) {
      // Re-queue the current track at the head and restart from it.
      const all = getStore().listMusicTracks();
      const t = all.find((x) => x.id === this.nowPlaying!.trackId);
      if (t) this.queue.unshift(t);
      this._playNextLibraryTrack();
    }
  }

  private _spawnFfmpegForInput(inputArgs: string[], onExit?: () => void): void {
    this._ensureFifos();
    this._killFfmpeg();

    // Suspend the music-side silence filler so it doesn't fight
    // the track writer for the FIFO. Only one writer per FIFO at
    // a time — POSIX guarantees both writers' output would be
    // interleaved at byte boundaries, which would corrupt PCM
    // samples. We resume the filler in `proc.on("exit")` below.
    // In tcp mode there is no filler (the relay handles silence).
    if (!TCP) this._suspendMusicFiller();

    // -re paces real-time so we don't fill the FIFO faster than
    // the streamer drains it.
    //
    // Loudness pipeline (v1.9.0 — was loudnorm before):
    //   - `volume=X` is the per-engine user volume knob.
    //   - `dynaudnorm` is a *fraction* of the CPU cost of EBU R128
    //     `loudnorm`. loudnorm in single-pass real-time mode is the
    //     single biggest music engine CPU sink (~10% on a Pi 5 just
    //     for one track at a time). dynaudnorm gives a similar
    //     perceptual leveling result for streaming purposes — peak
    //     normalisation per ~500ms window — at maybe 1-2% CPU. It
    //     can be overridden by setting MUSIC_LOUDNESS_FILTER in env
    //     for operators who want the older behaviour back.
    const loudnessFilter = process.env.MUSIC_LOUDNESS_FILTER
      || "dynaudnorm=f=500:g=15:p=0.95";
    const args = [
      "-hide_banner", "-loglevel", "warning", "-nostats",
      "-re",
      ...inputArgs,
      "-vn",
      "-af", `volume=${this.volume.toFixed(3)},${loudnessFilter}`,
      ...AUDIO_FORMAT,
      "-y", MUSIC_SINK,
    ];
    // v1.13.5: stdout=ignore. FFmpeg writes the PCM audio to
    // the music FIFO (the `-y MUSIC_FIFO` output), not stdout.
    // A previously-piped stdout had no `data` listener, so any
    // setup-time bytes FFmpeg emitted accumulated forever in
    // Node's stream buffer. stderr remains piped because we
    // actively read it for error-pattern detection.
    const proc = spawn(FF, args, { stdio: ["ignore", "ignore", "pipe"] });
    this.ffmpeg = proc;
    proc.stderr.on("data", (chunk) => {
      const line = chunk.toString().trim();
      if (line && /error|failed|cannot|unable/i.test(line)) {
        this.lastError = line;
      }
    });
    proc.on("exit", () => {
      this.ffmpeg = null;
      // Resume the silence filler on the music FIFO so the
      // streamer's open(music.fifo) stays satisfied between
      // tracks. amix in the streamer's filter graph carries on
      // mixing silence — the listener hears the silence.fifo
      // carrier (which is also silence when no music's playing,
      // so it's just quiet, as expected).
      if (!TCP) this._resumeMusicFiller();
      if (onExit) {
        try { onExit(); } catch (err) { console.warn("[music] onExit:", err); }
      }
    });
  }

  private _killFfmpeg(): void {
    if (!this.ffmpeg) return;
    try { this.ffmpeg.kill("SIGTERM"); } catch {}
    this.ffmpeg = null;
  }

  /**
   * The silence filler runs continuously on its own dedicated
   * FIFO. It's the always-on audio carrier the streamer's amix
   * uses as a baseline. Never killed except on container shutdown.
   */
  private _startSilenceFiller(): void {
    if (this.filler) return;
    this._ensureFifos();
    try {
      // v1.13.5: stderr=ignore (was pipe).
      //
      // The previous setup piped stderr but never registered a
      // `data` listener — meaning every byte FFmpeg emits sits
      // in Node's internal pipe buffer forever. anullsrc at
      // loglevel=error rarely says anything, but rare ≠ never;
      // a long-running container with sporadic errors would
      // slowly accumulate. ignore = the OS discards stderr
      // without ever giving it to us, so there's nothing to
      // accumulate.
      const proc = spawn(FF, [
        "-hide_banner", "-loglevel", "error", "-nostats",
        "-re",
        "-f", "lavfi",
        "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        ...AUDIO_FORMAT,
        "-y", SILENCE_FIFO,
      ], { stdio: ["ignore", "ignore", "ignore"] });
      this.filler = proc;
      proc.on("exit", () => {
        this.filler = null;
        // The filler should be immortal. If it dies (mkfifo race,
        // streamer not yet reading, etc.) wait a beat and respawn.
        setTimeout(() => this._startSilenceFiller(), 1000);
      });
    } catch (err: any) {
      this.lastError = `silence filler failed: ${err.message}`;
    }
  }

  private _stopSilenceFiller(): void {
    if (!this.filler) return;
    try { this.filler.kill("SIGTERM"); } catch {}
    this.filler = null;
  }

  /**
   * Silence filler dedicated to the music FIFO. Runs whenever
   * no real track is writing. Without this, the streamer's
   * ffmpeg blocks forever on open(music.fifo) when nothing is
   * queued at boot.
   */
  private _startMusicFiller(): void {
    if (this.musicFiller || this.musicFillerSuspended) return;
    this._ensureFifos();
    try {
      // v1.13.5: stderr=ignore — same reasoning as silence filler.
      const proc = spawn(FF, [
        "-hide_banner", "-loglevel", "error", "-nostats",
        "-re",
        "-f", "lavfi",
        "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        ...AUDIO_FORMAT,
        "-y", MUSIC_FIFO,
      ], { stdio: ["ignore", "ignore", "ignore"] });
      this.musicFiller = proc;
      proc.on("exit", () => {
        this.musicFiller = null;
        // Auto-respawn unless we're intentionally suspending it
        // to hand the FIFO off to a real track writer.
        if (!this.musicFillerSuspended) {
          setTimeout(() => this._startMusicFiller(), 250);
        }
      });
    } catch (err: any) {
      this.lastError = `music filler failed: ${err.message}`;
    }
  }

  private _suspendMusicFiller(): void {
    this.musicFillerSuspended = true;
    if (this.musicFiller) {
      try { this.musicFiller.kill("SIGTERM"); } catch {}
      this.musicFiller = null;
    }
  }

  private _resumeMusicFiller(): void {
    this.musicFillerSuspended = false;
    this._startMusicFiller();
  }

  private _ensureFifos(): void {
    // No FIFOs in tcp mode — the relay owns the audio path.
    if (TCP) return;
    for (const p of [SILENCE_FIFO, MUSIC_FIFO]) {
      if (fs.existsSync(p)) {
        try {
          if (fs.statSync(p).isFIFO()) {
            // Re-chmod in case it was created earlier with a
            // stricter mode. The streamer container's user must
            // be able to open it O_RDWR for the keep-alive fd
            // it holds to unblock FFmpeg's O_RDONLY open.
            try { fs.chmodSync(p, 0o666); } catch {}
            continue;
          }
        } catch {}
      }
      // mkfifo -m 666 sets the mode directly, bypassing umask.
      // We still re-chmod after in case the platform mkfifo
      // ignores the -m flag (rare, but cheap to be defensive).
      try {
        spawn("mkfifo", ["-m", "666", p]).on("error", (err) => {
          this.lastError = `mkfifo ${p} failed: ${err.message}`;
        }).on("exit", () => {
          try { fs.chmodSync(p, 0o666); } catch {}
        });
      } catch (err: any) {
        this.lastError = `mkfifo ${p} failed: ${err.message}`;
      }
    }
  }

  private _ensureFifoSilently(): boolean {
    // In tcp mode the audio path is always "ready" — the relay is
    // started by the desktop app before the music engine boots.
    if (TCP) return true;
    try {
      return fs.statSync(SILENCE_FIFO).isFIFO() && fs.statSync(MUSIC_FIFO).isFIFO();
    } catch { return false; }
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

let _engine: MusicEngine | null = null;
export function musicEngine(): MusicEngine { return _engine ||= new MusicEngine(); }
