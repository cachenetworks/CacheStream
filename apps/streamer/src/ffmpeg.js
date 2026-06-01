"use strict";

/**
 * Pure FFmpeg argv builders, shared by both render backends:
 *
 *   - the Docker streamer (apps/streamer/src/stream.js), which
 *     captures via headless-Chromium CDP screencast, and
 *   - the Electron desktop streamer (apps/desktop), which captures
 *     via an offscreen BrowserWindow's `paint` event.
 *
 * Both feed FFmpeg the same MJPEG-over-stdin input and the same
 * H.264/AAC → FLV → RTMP output, so the codec + filter argv is
 * identical between them. Keeping it here as dependency-free
 * functions lets the desktop app vendor this one file rather than
 * the whole Chromium/puppeteer pipeline.
 */

/**
 * Build the codec-specific portion of the FFmpeg argv.
 *
 * The auto-profile may pick a hardware encoder (h264_v4l2m2m on a
 * Raspberry Pi, h264_nvenc on NVIDIA, etc.). Those encoders ignore
 * libx264's `-preset` / `-tune` / `-x264-params` flags and need
 * their own. This helper centralises the differences so the main
 * argv stays readable.
 */
function buildVideoCodecArgs(video) {
  const codec = video.codec || "libx264";
  const common = [
    "-c:v", codec,
    "-pix_fmt", "yuv420p",
    "-r", String(video.fps),
    "-g", String(video.fps * 2),
    "-keyint_min", String(video.fps * 2),
    "-sc_threshold", "0",
    "-b:v", `${video.bitrateKbps}k`,
    "-maxrate", `${video.maxrateKbps}k`,
    "-bufsize", `${video.bufsizeKbps}k`,
  ];

  if (codec === "libx264") {
    return [
      ...common,
      "-preset", video.preset,
      ...(video.tune ? ["-tune", video.tune] : []),
      "-profile:v", "high",
      "-x264-params", `threads=${video.x264Threads || 0}:lookahead-threads=1`,
    ];
  }

  if (codec === "h264_nvenc") {
    return [
      ...common,
      // NVENC's analogue of `veryfast`. p1=fastest, p7=slowest.
      "-preset", "p4",
      "-tune",   "ll",         // low-latency for live streaming
      "-rc",     "cbr",
      "-profile:v", "high",
    ];
  }

  if (codec === "h264_qsv") {
    return [
      ...common,
      "-preset", "veryfast",
      "-profile:v", "high",
      "-look_ahead", "0",
    ];
  }

  if (codec === "h264_v4l2m2m") {
    // Raspberry Pi hardware encoder. Doesn't support `-preset` —
    // its quality control is bitrate alone (already set in common).
    // num_capture_buffers=32 prevents the Pi's frame-grabber from
    // running dry under jitter.
    return [
      ...common,
      "-num_capture_buffers", "32",
    ];
  }

  if (codec === "h264_videotoolbox") {
    return [
      ...common,
      "-profile:v", "high",
      "-allow_sw", "1",
    ];
  }

  // Unknown codec — fall back to libx264 flags rather than break.
  return [
    ...common,
    "-preset", video.preset,
    "-profile:v", "high",
  ];
}

/**
 * Build the minimum video filter chain for the configured output.
 *
 * The defaults (capture at the same width/height/fps we're encoding
 * at) need NO filters at all — the input is already the right size,
 * the right rate, and a JPEG the encoder accepts directly thanks to
 * `-pix_fmt yuv420p` in buildVideoCodecArgs.
 *
 * Filters cost real CPU per frame in software-only pipelines (the
 * Pi path). Eliding them entirely in the common case is a
 * measurable win. Returns a comma-joined filter string, or null
 * when no filters are needed.
 */
function buildVideoFilters(video) {
  const steps = [];
  // The capture source emits frames at the page's repaint rate,
  // capped by `captureEveryNthFrame`. When that's 1 and the page
  // renders at a stable rate >= video.fps, we already have
  // video.fps frames — the `fps=` filter would be a no-op pacer.
  // Only add it for the low-CPU capture-every-nth-frame mode.
  if (video.captureEveryNthFrame && video.captureEveryNthFrame > 1) {
    steps.push(`fps=${video.fps}`);
  }
  return steps.length > 0 ? steps.join(",") : null;
}

module.exports = { buildVideoCodecArgs, buildVideoFilters };
