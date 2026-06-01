"use strict";

/**
 * Internal-API bearer token bootstrap — the JS equivalent of the
 * web container's entrypoint.sh logic, but for a single-host app.
 *
 * The web child process and the in-process streamer must share one
 * token. We persist it next to the user data so it survives app
 * restarts (the streamer state itself doesn't persist, but a stable
 * token avoids surprises and matches the Docker contract).
 */

const fs = require("node:fs");
const crypto = require("node:crypto");

function loadOrCreateToken(tokenFile) {
  if (process.env.INTERNAL_API_TOKEN && process.env.INTERNAL_API_TOKEN.trim()) {
    return process.env.INTERNAL_API_TOKEN.trim();
  }
  try {
    const existing = fs.readFileSync(tokenFile, "utf8").trim();
    if (existing) return existing;
  } catch { /* no file yet */ }

  const token = crypto.randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  } catch { /* best effort; token still usable in-memory this run */ }
  return token;
}

module.exports = { loadOrCreateToken };
