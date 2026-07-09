# syntax=docker/dockerfile:1

# ── deps: production node_modules (native postinstalls must run) ─────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev \
  && test -f node_modules/node-datachannel/build/Release/node_datachannel.node \
  && npm cache clean --force

# ── build: compile bundle + copy ensure into dist ───────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# ── runtime: minimal image with clipboard helper ────────────────────────────
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini xclip \
  && addgroup -S torlnk \
  && adduser -S torlnk -G torlnk
WORKDIR /app
ENV NODE_ENV=production \
    TORLNK_SKIP_UPDATE=1 \
    TORLINK_STATE_DIR=/data \
    TORLINK_DOWNLOAD_DIR=/downloads \
    TORLINK_DISABLE_NAT=1
COPY --from=build --chown=torlnk:torlnk /app/dist ./dist
COPY --from=deps --chown=torlnk:torlnk /app/node_modules ./node_modules
COPY --chown=torlnk:torlnk package.json ./
USER torlnk
VOLUME ["/data", "/downloads"]
ENV TORLINK_STATE_DIR=/data \
    TORLINK_DOWNLOAD_DIR=/downloads
ENTRYPOINT ["/sbin/tini", "--", "node", "dist/cli.cjs"]
CMD []
