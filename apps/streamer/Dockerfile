# syntax=docker/dockerfile:1.7
# =========================================================
# cachestream-streamer — Headless Chromium + FFmpeg worker
# =========================================================
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    HOME=/home/streamer \
    XDG_CONFIG_HOME=/home/streamer/.config \
    XDG_CACHE_HOME=/home/streamer/.cache \
    CHROMIUM_RUNTIME_DIR=/tmp/cachestream-chromium

# util-linux gives us setpriv, which the entrypoint uses to
# drop from root → streamer after fixing volume perms.
# The Mesa DRI/EGL packages (libegl1, libgles2, libgl1-mesa-dri,
# mesa-va-drivers) let in-container Chromium rasterise on the GPU
# (Pi VideoCore / V3D via /dev/dri) when STREAM_CHROMIUM_GPU is on
# — without them Chromium silently falls back to CPU SwiftShader.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ffmpeg \
      ca-certificates \
      dumb-init \
      util-linux \
      wget \
      fonts-liberation \
      fonts-noto-core \
      fonts-noto-color-emoji \
      libnss3 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libcups2 \
      libdrm2 \
      libxkbcommon0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxrandr2 \
      libgbm1 \
      libegl1 \
      libgles2 \
      libgl1-mesa-dri \
      mesa-va-drivers \
      libpango-1.0-0 \
      libcairo2 \
      libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY src ./src
COPY entrypoint.sh /usr/local/bin/cachestream-entrypoint
RUN chmod +x /usr/local/bin/cachestream-entrypoint

# Create the unprivileged user the entrypoint will drop to.
# We do NOT `USER streamer` here — the entrypoint runs as root
# first to chown the audio volume, then drops privileges.
RUN useradd --system --create-home --shell /usr/sbin/nologin streamer \
    && mkdir -p /home/streamer/.config /home/streamer/.cache /tmp/cachestream-chromium \
    && chown -R streamer:streamer /app /home/streamer /tmp/cachestream-chromium

ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/cachestream-entrypoint"]
CMD ["node", "src/index.js"]
