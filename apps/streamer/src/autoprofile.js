"use strict";

/**
 * Auto-adaptive CPU profile.
 *
 * Detects the host (CPU model, cores, arch, RAM, Pi presence,
 * hardware encoder availability) and produces a tuned encoder
 * profile so a fresh `docker compose up` works well on
 * anything from a Raspberry Pi 4 to a 16-core server.
 *
 * Why this exists:
 *   - The streamer's default profile is 1080p30 @ 4500 kbps with
 *     libx264 `veryfast`, which saturates a Pi 4 (it can't
 *     actually keep up with 1080p30 software-encoded x264).
 *   - On a real server the same defaults are wasteful — we have
 *     plenty of headroom for higher-quality settings.
 *
 * The profile is picked once at boot and exposed via
 * `pickAutoProfile(logger)`. Live throttling (e.g. when a Pi
 * thermal-throttles) happens in thermal.js.
 *
 * Operator overrides always win: any STREAM_* env var set to a
 * non-default value is respected (see config.js — this module
 * just supplies the defaults config.js uses when env vars are
 * absent or `auto`).
 */

const fs = require("node:fs");
const os = require("node:os");
const { execSync } = require("node:child_process");

// ---- Host detection --------------------------------------------

function readFile(path) {
  try { return fs.readFileSync(path, "utf8"); } catch { return ""; }
}

function detectHost() {
  const arch = os.arch(); // "x64", "arm64", "arm"
  const cores = os.cpus()?.length || 1;
  const cpuModel = os.cpus()?.[0]?.model || "unknown";
  const totalMemGB = Math.round(os.totalmem() / (1024 ** 3) * 10) / 10;

  // /proc/cpuinfo tells us if we're on a Pi (and which model).
  const cpuinfo = readFile("/proc/cpuinfo");
  const piModel = (cpuinfo.match(/Model\s*:\s*(.+)/i) || [])[1] || null;
  const isPi = /raspberry pi/i.test(piModel || "") || /BCM\d+/i.test(cpuModel);

  // Pi 5 dropped the v4l2m2m H.264 encoder block — the BCM2712 has
  // no fixed-function H.264 hardware. We must NOT pick h264_v4l2m2m
  // on a Pi 5 even though the FFmpeg binary still lists it.
  // Also check the Hardware field (BCM2712) as a fallback in case
  // the Model string is absent or formatted differently in future firmware.
  const isPi5 = /raspberry pi 5/i.test(piModel || "") || /BCM2712/i.test(cpuinfo);

  // Generic "weak ARM box" detector: ARM with <= 4 cores or <= 4 GB RAM.
  const isWeakArm = (arch === "arm" || arch === "arm64") && (cores <= 4 || totalMemGB <= 4);

  return { arch, cores, cpuModel, totalMemGB, piModel, isPi, isPi5, isWeakArm };
}

function pathExists(path) {
  try { return fs.existsSync(path); } catch { return false; }
}

function hasNvidiaDevice() {
  return pathExists("/dev/nvidiactl") || pathExists("/dev/nvidia0");
}

function hasIntelRenderDevice() {
  return pathExists("/dev/dri/renderD128") || pathExists("/dev/dri/card0");
}

// ---- Hardware encoder probing ----------------------------------

function ffmpegEncoders() {
  try {
    // FFMPEG_PATH lets the Electron desktop build point at its
    // bundled static binary (there's no ffmpeg on PATH on Windows).
    // In Docker it's unset and we fall back to the PATH `ffmpeg`.
    // Quote the path so spaces in a Windows install dir survive the
    // shell. `2>NUL`/`2>/dev/null` differ per-OS, so just drop the
    // redirect and let stderr flow to our (ignored) parent stderr.
    const bin = process.env.FFMPEG_PATH || "ffmpeg";
    const out = execSync(`"${bin}" -hide_banner -encoders`, {
      encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"],
    });
    return out;
  } catch {
    return "";
  }
}

/**
 * Returns the best available H.264 encoder name + a friendly tag
 * for logging. Preference order:
 *   - h264_v4l2m2m  (Raspberry Pi hardware encoder — Pi 4 only)
 *   - h264_nvenc    (NVIDIA)
 *   - h264_qsv      (Intel Quick Sync)
 *   - libx264       (software fallback, always available)
 *
 * Hosts we deliberately exclude from HW encoder selection:
 *   - Raspberry Pi 5: BCM2712 has NO fixed-function H.264 encoder.
 *     FFmpeg still lists h264_v4l2m2m as available because the
 *     binary was compiled with v4l2 support, but no device exists.
 *     Opening it crashes; we'd end up in a reconnect loop.
 *   - x86/x64 servers without a visible GPU device. Debian FFmpeg can
 *     list h264_nvenc/h264_qsv because support was compiled in, even
 *     when Docker has no /dev/nvidia* or /dev/dri device. Picking those
 *     by name alone makes AMD64 servers reconnect forever instead of
 *     streaming.
 *
 * We also skip h264_omx (deprecated on Pi OS, broken on 64-bit
 * Pis) and h264_vaapi (requires extra device passthrough).
 */
function pickEncoder(host) {
  const enc = ffmpegEncoders();
  const isArm = host?.arch === "arm64" || host?.arch === "arm";

  // FFmpeg's `-encoders` output lists every codec the binary was
  // compiled with — NOT what the host actually has. On ARM Linux
  // builds you'll see h264_nvenc / h264_qsv listed even though no
  // NVIDIA / Intel hardware exists, because the libraries ship in
  // the package. We have to gate by host signature, not by
  // ffmpeg's claim of support.
  //
  // Rules:
  //   - Pi 4   → may use h264_v4l2m2m. Older models too.
  //   - Pi 5   → no HW H.264 encoder at all. Software only.
  //   - ARM but not a Pi → assume no HW path (rare hosts do, but
  //     they're rare enough that requiring an explicit override
  //     via STREAM_VIDEO_CODEC is the safer default).
  //   - x86/x64 with /dev/nvidia* -> consider NVENC.
  //   - x86/x64 with /dev/dri/*     -> consider QSV.
  //   - x86/x64 without GPU devices -> software libx264.
  const candidates = [];
  if (host?.isPi && !host.isPi5) {
    candidates.push({ name: "h264_v4l2m2m", tag: "Raspberry Pi V4L2 M2M (HW)" });
  }
  if (!isArm && hasNvidiaDevice()) {
    candidates.push({ name: "h264_nvenc", tag: "NVIDIA NVENC (HW)" });
  }
  if (!isArm && hasIntelRenderDevice()) {
    candidates.push({ name: "h264_qsv", tag: "Intel Quick Sync (HW)" });
  }
  for (const c of candidates) {
    // Encoder lines look like:  " V..... h264_nvenc           NVIDIA NVENC ..."
    const re = new RegExp(`^\\s*V[\\.\\w]*\\s+${c.name}\\b`, "m");
    if (re.test(enc)) return { codec: c.name, tag: c.tag };
  }
  return { codec: "libx264", tag: "libx264 (software)" };
}

// ---- Profile selection -----------------------------------------

/**
 * Pick reasonable encode settings for the current host.
 * Returns a "defaults" object — config.js merges these under any
 * explicit STREAM_* env vars the operator set.
 *
 * Categories:
 *   - 'pi5'       : Raspberry Pi 5 (BCM2712). No HW H.264 encoder, but
 *                   Cortex-A76 cores are fast enough for 720p30 veryfast.
 *   - 'pi'        : Raspberry Pi 4 and older. 720p30, HW encoder when available.
 *   - 'small-arm' : Weak ARM box, but not a Pi. 720p30 ultrafast.
 *   - 'modest'    : 1-2 cores x86. 720p30 veryfast.
 *   - 'standard'  : 4-8 cores x86. 1080p30 veryfast (current defaults).
 *   - 'fat'       : >8 cores x86. 1080p60 medium (no zerolatency).
 */
function pickProfile(host, encoder) {
  let category;

  if (host.isPi5) {
    category = "pi5";
  } else if (host.isPi) {
    category = "pi";
  } else if (host.isWeakArm) {
    category = "small-arm";
  } else if (host.cores <= 2) {
    category = "modest";
  } else if (host.cores >= 12) {
    category = "fat";
  } else {
    category = "standard";
  }

  // Hardware encoders skip the x264 preset / threads negotiation.
  const isHw = encoder.codec !== "libx264";

  // Base profile lookup.
  const base = {
    // Pi 5 (BCM2712, Cortex-A76 @ 2.4 GHz): no HW H.264 encoder, but the
    // faster cores handle veryfast comfortably. x264Threads=3 leaves one
    // core free for Chromium rendering and the OS.
    pi5: {
      width: 1280, height: 720, fps: 30,
      bitrateKbps: 3500, maxrateKbps: 3500, bufsizeKbps: 7000,
      audioBitrateKbps: 128,
      preset: "veryfast",
      x264Threads: 3,
      tune: "zerolatency",
      screencastQuality: 70,
      captureEveryNthFrame: 1,
    },
    pi: {
      width: 1280, height: 720, fps: 30,
      bitrateKbps: 2800, maxrateKbps: 2800, bufsizeKbps: 5600,
      audioBitrateKbps: 96,
      preset: "ultrafast",
      x264Threads: 3,
      tune: "zerolatency",
      screencastQuality: 60,
      captureEveryNthFrame: 1,
    },
    "small-arm": {
      width: 1280, height: 720, fps: 30,
      bitrateKbps: 3000, maxrateKbps: 3000, bufsizeKbps: 6000,
      audioBitrateKbps: 96,
      preset: "ultrafast",
      x264Threads: Math.max(2, host.cores - 1),
      tune: "zerolatency",
      screencastQuality: 62,
      captureEveryNthFrame: 1,
    },
    modest: {
      width: 1280, height: 720, fps: 30,
      bitrateKbps: 3500, maxrateKbps: 3500, bufsizeKbps: 7000,
      audioBitrateKbps: 128,
      preset: "veryfast",
      x264Threads: host.cores,
      tune: "zerolatency",
      screencastQuality: 70,
      captureEveryNthFrame: 1,
    },
    standard: {
      width: 1920, height: 1080, fps: 30,
      bitrateKbps: 4500, maxrateKbps: 4500, bufsizeKbps: 9000,
      audioBitrateKbps: 128,
      preset: "veryfast",
      x264Threads: 0, // auto = all cores
      tune: "zerolatency",
      screencastQuality: 70,
      captureEveryNthFrame: 1,
    },
    fat: {
      width: 1920, height: 1080, fps: 60,
      bitrateKbps: 6000, maxrateKbps: 6000, bufsizeKbps: 12000,
      audioBitrateKbps: 160,
      preset: "medium",
      x264Threads: 0,
      tune: "",                  // disable zerolatency → better quality
      screencastQuality: 78,
      captureEveryNthFrame: 1,
    },
  }[category];

  // On hardware encoders, x264 preset/threads/tune don't apply, but
  // we still pass them through so config.js shape stays the same.
  // We bump quality knobs upward since the HW encoder is much
  // cheaper than software.
  if (isHw && category === "pi") {
    base.fps = 30;
    base.bitrateKbps = 3500;
    base.screencastQuality = 70;
  }

  return { ...base, category, codec: encoder.codec, codecTag: encoder.tag };
}

// ---- Public ----------------------------------------------------

function pickAutoProfile(logger) {
  const host = detectHost();
  const encoder = pickEncoder(host);
  const profile = pickProfile(host, encoder);

  logger?.info?.({
    arch: host.arch, cores: host.cores, ramGB: host.totalMemGB,
    cpu: host.cpuModel, piModel: host.piModel,
    profile: profile.category,
    encoder: profile.codecTag,
    resolution: `${profile.width}x${profile.height}@${profile.fps}`,
    videoBitrateKbps: profile.bitrateKbps,
  }, "auto-profile picked");

  return { host, encoder, profile };
}

module.exports = { pickAutoProfile, detectHost, pickEncoder, pickProfile };
