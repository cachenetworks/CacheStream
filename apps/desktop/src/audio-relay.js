"use strict";

/**
 * Cross-platform audio relay (replaces the two Linux FIFOs).
 *
 * The Docker build pipes music PCM to the streamer's FFmpeg through
 * named FIFOs on a shared volume. Windows has no mkfifo and there's
 * no shared volume in a single-process desktop app, so we relay PCM
 * over loopback TCP instead.
 *
 *        web music FFmpeg (-re, s16le)             streamer FFmpeg
 *          tcp://127.0.0.1:inPort  ──▶  RELAY  ──▶  tcp://127.0.0.1:outPort
 *                                        │
 *                                        └─ emits paced silence when
 *                                           no music writer is connected
 *
 * Both FFmpegs connect as TCP *clients*; the relay is the server for
 * both ports. The key property the streamer needs is that its audio
 * input never hits EOF — so the relay holds the consumer socket open
 * forever and fills the gaps between tracks with real-time silence.
 * That's the same guarantee the FIFO keep-alive + silence filler
 * gave on Linux, collapsed into one place.
 *
 * Audio format is fixed s16le / 44.1 kHz / stereo (matches the web
 * music engine + the streamer audio input args).
 */

const net = require("node:net");

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_SEC = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE; // 176400
const TICK_MS = 100;
const SILENCE_CHUNK = Buffer.alloc(Math.round(BYTES_PER_SEC * TICK_MS / 1000)); // 17640 B

class AudioRelay {
  constructor({ inPort, outPort, logger }) {
    this.inPort = inPort;
    this.outPort = outPort;
    this.logger = logger || console;
    this.writer = null;     // connected web music FFmpeg socket
    this.consumer = null;   // connected streamer FFmpeg socket
    this.silenceTimer = null;
    this._inServer = null;
    this._outServer = null;
  }

  start() {
    // IN: accept the per-track music writer. Only the latest writer
    // is forwarded; an older one (mid-handoff) is dropped.
    this._inServer = net.createServer((sock) => {
      if (this.writer) { try { this.writer.destroy(); } catch {} }
      this.writer = sock;
      sock.on("data", (chunk) => {
        // Passthrough: the writer uses -re, so it self-paces. While a
        // writer is connected the silence ticker stays quiet.
        if (this.consumer && this.consumer.writable) this.consumer.write(chunk);
      });
      const clear = () => { if (this.writer === sock) this.writer = null; };
      sock.on("close", clear);
      sock.on("error", clear);
    });
    this._inServer.on("error", (e) => this.logger.warn?.({ err: e?.message }, "audio relay in-server error"));
    this._inServer.listen(this.inPort, "127.0.0.1");

    // OUT: accept the streamer FFmpeg consumer and keep it open.
    this._outServer = net.createServer((sock) => {
      if (this.consumer) { try { this.consumer.destroy(); } catch {} }
      this.consumer = sock;
      sock.on("error", () => {});
      const clear = () => { if (this.consumer === sock) this.consumer = null; };
      sock.on("close", clear);
    });
    this._outServer.on("error", (e) => this.logger.warn?.({ err: e?.message }, "audio relay out-server error"));
    this._outServer.listen(this.outPort, "127.0.0.1");

    // Real-time silence pacer. Fires only when there's a consumer but
    // no music writer — keeping the streamer's audio input alive.
    this.silenceTimer = setInterval(() => {
      if (this.consumer && this.consumer.writable && !this.writer) {
        this.consumer.write(SILENCE_CHUNK);
      }
    }, TICK_MS);
    this.silenceTimer.unref?.();

    this.logger.info?.({ inPort: this.inPort, outPort: this.outPort }, "audio relay listening");
  }

  stop() {
    if (this.silenceTimer) { clearInterval(this.silenceTimer); this.silenceTimer = null; }
    for (const s of [this.writer, this.consumer]) { try { s?.destroy(); } catch {} }
    this.writer = this.consumer = null;
    try { this._inServer?.close(); } catch {}
    try { this._outServer?.close(); } catch {}
  }
}

module.exports = { AudioRelay };
