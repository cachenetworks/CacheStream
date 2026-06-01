"use strict";

/**
 * Launch the bundled Next.js standalone panel as a child Node
 * process and wait for it to answer /api/health.
 *
 * We use Electron's `utilityProcess.fork`, which runs the script on
 * Electron's own bundled Node runtime — so the native better-sqlite3
 * binary inside the web bundle only has to match ONE ABI (Electron's),
 * which is exactly what scripts/build-web.mjs rebuilds it against.
 */

const path = require("node:path");
const http = require("node:http");
const { utilityProcess } = require("electron");

/**
 * @param {object} opts
 * @param {string} opts.bundleDir   build/web (contains server.js)
 * @param {number} opts.port        web server port
 * @param {object} opts.env         extra env (token, dirs, audio, etc.)
 * @param {(line:string)=>void} opts.onLog
 */
function startWebServer({ bundleDir, port, env, onLog = () => {} }) {
  const serverJs = path.join(bundleDir, "server.js");

  const child = utilityProcess.fork(serverJs, [], {
    // Next's standalone server resolves .next + node_modules relative
    // to its own location, so cwd must be the bundle dir.
    cwd: bundleDir,
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      ...env,
    },
  });

  child.stdout?.on("data", (d) => onLog(`[web] ${d.toString().trimEnd()}`));
  child.stderr?.on("data", (d) => onLog(`[web!] ${d.toString().trimEnd()}`));

  const ready = waitForHealth(port, 30_000);
  return { child, ready };
}

function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/api/health", timeout: 2000 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) return resolve(true);
          retry();
        }
      );
      req.on("error", retry);
      req.on("timeout", () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error("web server did not become healthy in time"));
      setTimeout(tick, 400);
    };
    tick();
  });
}

module.exports = { startWebServer };
