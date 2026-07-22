ARG NODE_IMAGE=docker.io/library/node:24-bookworm-slim

FROM ${NODE_IMAGE} AS build

WORKDIR /opt/torlink

COPY . .
RUN npm ci \
    && npm run build \
    && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    HOME=/home/node \
    TORLINK_STATE_DIR=/state \
    TORLINK_NO_UPDATE_CHECK=1

WORKDIR /opt/torlink

COPY --from=build --chown=node:node /opt/torlink/package.json ./package.json
COPY --from=build --chown=node:node /opt/torlink/dist ./dist
COPY --from=build --chown=node:node /opt/torlink/node_modules ./node_modules

# Keep writable paths usable when the runtime assigns an arbitrary UID in GID 0.
RUN install -d -o 1000 -g 0 /state /home/node/Downloads/torlink \
    && chmod -R g=u /state /home/node/Downloads/torlink

USER 1000

VOLUME ["/state", "/home/node/Downloads/torlink"]
EXPOSE 9160 9161

ENTRYPOINT ["node", "/opt/torlink/dist/cli.cjs"]
