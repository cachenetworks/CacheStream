#!/bin/sh
# =========================================================
# cachestream-streamer entrypoint
# =========================================================
# Runs briefly as root to fix permissions on the shared
# /app/audio volume + pick up the INTERNAL_API_TOKEN from
# the shared bootstrap file (written by the web container),
# then drops to `streamer` before exec'ing the Node command.
# =========================================================
set -e

# /app/audio is a shared IPC volume — the web container's
# `nextjs` user also writes to it (silence + music FIFOs +
# the bootstrap token file). World-writable is fine; only
# ever holds named pipes + a token file at mode 0644.
if [ -d "/app/audio" ]; then
  chmod 0777 /app/audio 2>/dev/null || true
fi

# Chromium runs after we drop privileges. Keep HOME/XDG paths off
# /root and provide writable profile/crashpad directories on /tmp.
export HOME=/home/streamer
export XDG_CONFIG_HOME=/home/streamer/.config
export XDG_CACHE_HOME=/home/streamer/.cache
export CHROMIUM_RUNTIME_DIR="${CHROMIUM_RUNTIME_DIR:-/tmp/cachestream-chromium}"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" \
  "$CHROMIUM_RUNTIME_DIR/profiles" "$CHROMIUM_RUNTIME_DIR/crashpad" 2>/dev/null || true
chown -R streamer:streamer "$HOME" "$CHROMIUM_RUNTIME_DIR" 2>/dev/null || true
chmod 0700 "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" 2>/dev/null || true
chmod 0777 "$CHROMIUM_RUNTIME_DIR" "$CHROMIUM_RUNTIME_DIR/profiles" "$CHROMIUM_RUNTIME_DIR/crashpad" 2>/dev/null || true

# Existing FIFOs may have been created by the web container
# with mkfifo's default 0644 (umask 0022). The streamer user
# can't open them O_RDWR for the keep-alive trick we use to
# unblock FFmpeg's O_RDONLY open. Re-chmod here while we still
# have root, before dropping to the streamer user. Safe to run
# unconditionally — if the FIFO doesn't exist yet, the chmod
# silently no-ops and the streamer process creates it later
# with the explicit `mkfifo -m 666` path.
for fifo in /app/audio/silence.fifo /app/audio/music.fifo; do
  if [ -p "$fifo" ]; then
    chmod 0666 "$fifo" 2>/dev/null || true
  fi
done

# ─── INTERNAL_API_TOKEN bootstrap ────────────────────────────
# If the operator pinned a value in .env, that wins. Otherwise
# we read from the shared file written by the web container.
# Wait up to 30s for the file to appear — `depends_on` in
# compose only waits for the container to START, not for the
# entrypoint to finish writing the token.
TOKEN_FILE=/app/audio/.internal-api-token
if [ -z "$INTERNAL_API_TOKEN" ]; then
  i=0
  while [ ! -s "$TOKEN_FILE" ] && [ $i -lt 60 ]; do
    if [ $i -eq 0 ]; then
      echo "[entrypoint] waiting for web container to write $TOKEN_FILE …"
    fi
    sleep 0.5
    i=$((i + 1))
  done
  if [ -s "$TOKEN_FILE" ]; then
    INTERNAL_API_TOKEN="$(cat "$TOKEN_FILE")"
    echo "[entrypoint] using INTERNAL_API_TOKEN from $TOKEN_FILE"
  else
    echo "[entrypoint] ERROR: $TOKEN_FILE never appeared. Is the web container running?"
    echo "[entrypoint] You can also pin INTERNAL_API_TOKEN= in .env."
    exit 1
  fi
fi
export INTERNAL_API_TOKEN

# Drop privileges. `setpriv --init-groups` resets supplementary
# groups to whatever `streamer` actually belongs to.
exec setpriv --reuid=streamer --regid=streamer --init-groups -- "$@"
