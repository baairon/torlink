# syntax=docker/dockerfile:1

# ── deps: production node_modules (native postinstalls must run) ─────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --loglevel=error \
  && test -f node_modules/node-datachannel/build/Release/node_datachannel.node \
  && npm cache clean --force 2>/dev/null || npm cache clean

# ── build: compile bundle + copy ensure into dist ───────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --loglevel=error
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# ── runtime: minimal image with clipboard helper ────────────────────────────
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini xclip \
  && addgroup -S torzlink \
  && adduser -S torzlink -G torzlink \
  && mkdir -p /data /downloads \
  && chown -R torzlink:torzlink /data /downloads
WORKDIR /app
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    COLORTERM=truecolor \
    FORCE_COLOR=3 \
    TERM=xterm-256color \
    NODE_ENV=production \
    TORZLINK_SKIP_UPDATE=1 \
    TORZLINK_STATE_DIR=/data \
    TORZLINK_DOWNLOAD_DIR=/downloads \
    TORZLINK_DISABLE_NAT=1
COPY --from=build --chown=torzlink:torzlink /app/dist ./dist
COPY --from=deps --chown=torzlink:torzlink /app/node_modules ./node_modules
COPY --chown=torzlink:torzlink package.json ./
USER torzlink
VOLUME ["/data", "/downloads"]
ENTRYPOINT ["/sbin/tini", "--", "node", "dist/cli.cjs"]
CMD []
