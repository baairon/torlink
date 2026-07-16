#!/usr/bin/env bash
# Deploy TorZlink from a dev machine to a Docker NAS (no GHCR required).
# Build local image → scp tar → docker load → compose up on NAS.
#
# Usage:
#   NAS_USER=admin ./tools/deploy-from-dev.sh
#   NAS_USER=admin PROXY_NET_NAME=foo_proxy_net ./tools/deploy-from-dev.sh
#   NAS_USER=admin SKIP_BUILD=1 ./tools/deploy-from-dev.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_ENV="${REPO_ROOT}/.env"

# Load project .env into the environment (without exporting comments)
if [[ -f "${LOCAL_ENV}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${LOCAL_ENV}"
  set +a
fi

NAS_HOST="${NAS_HOST:-192.168.1.5}"
NAS_USER="${NAS_USER:-puper}"
NAS_PASSWORD="${NAS_PASSWORD:-}"
DEPLOY_DIR="${TORZLINK_DEPLOY_DIR:-/volume2/Docker_Configs/torzlink-deploy}"
NETWORK_MODE="${TORZLINK_NETWORK_MODE:-direct}"
PROXY_NET_NAME="${PROXY_NET_NAME:-0-nas_proxy_net}"
IMAGE_NAME="${TORZLINK_IMAGE_NAME:-torzlink}"
IMAGE_TAG="${TORZLINK_IMAGE_TAG:-}"
SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_TELEGRAM_SYNC="${SKIP_TELEGRAM_SYNC:-0}"

die() { echo "error: $*" >&2; exit 1; }
info() { echo "→ $*"; }

[[ -n "${NAS_USER}" ]] || die "set NAS_USER (e.g. NAS_USER=puper ./tools/deploy-from-dev.sh)"
case "${NETWORK_MODE}" in direct|vpn) ;; *) die "TORZLINK_NETWORK_MODE must be direct|vpn" ;; esac

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }
need_cmd docker
need_cmd ssh
need_cmd scp

if [[ -z "${IMAGE_TAG}" ]]; then
  IMAGE_TAG="v$(node -p "require('${REPO_ROOT}/package.json').version")"
fi
IMAGE_REF="${IMAGE_NAME}:${IMAGE_TAG}"
REMOTE="${NAS_USER}@${NAS_HOST}"

SSH_OPTS=( -o StrictHostKeyChecking=accept-new )
# Optional: TORZLINK_SSH_OPTS="-F /dev/null"
# shellcheck disable=SC2206
[[ -n "${TORZLINK_SSH_OPTS:-}" ]] && SSH_OPTS+=( ${TORZLINK_SSH_OPTS} )

SSH_BIN=(ssh)
SCP_BIN=(scp)
if [[ -n "${NAS_PASSWORD}" ]]; then
  if command -v sshpass >/dev/null 2>&1; then
    export SSHPASS="${NAS_PASSWORD}"
    SSH_BIN=(sshpass -e ssh)
    SCP_BIN=(sshpass -e scp)
    SSH_OPTS+=( -o PreferredAuthentications=password -o PubkeyAuthentication=no )
    info "using NAS_PASSWORD via sshpass"
  else
    die "NAS_PASSWORD is set but sshpass is not installed (apt/brew install sshpass, or use SSH keys)"
  fi
fi

ssh_nas() { "${SSH_BIN[@]}" "${SSH_OPTS[@]}" "${REMOTE}" "$@"; }
scp_to() { "${SCP_BIN[@]}" "${SSH_OPTS[@]}" "$1" "${REMOTE}:$2"; }
scp_from() { "${SCP_BIN[@]}" "${SSH_OPTS[@]}" "${REMOTE}:$1" "$2"; }

read_env() {
  local file="$1" key="$2"
  [[ -f "${file}" ]] || return 0
  grep -E "^[[:space:]]*${key}=" "${file}" | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//'
}

set_env_key() {
  local file="$1" key="$2" value="$3"
  if grep -qE "^[[:space:]]*${key}=" "${file}" 2>/dev/null; then
    # portable-ish in-place replace
    local tmp
    tmp="$(mktemp)"
    awk -v k="${key}" -v v="${value}" '
      BEGIN { done=0 }
      $0 ~ "^[[:space:]]*"k"=" { print k"="v; done=1; next }
      { print }
      END { if (!done) print k"="v }
    ' "${file}" >"${tmp}"
    mv "${tmp}" "${file}"
  else
    printf '%s=%s\n' "${key}" "${value}" >>"${file}"
  fi
}

info "target ${REMOTE}  deploy=${DEPLOY_DIR}  image=${IMAGE_REF}  mode=${NETWORK_MODE}"

if [[ "${SKIP_BUILD}" != "1" ]]; then
  info "docker build ${IMAGE_REF}"
  docker build -f "${REPO_ROOT}/packaging/docker/Dockerfile" -t "${IMAGE_REF}" "${REPO_ROOT}"
else
  info "skip build"
  docker image inspect "${IMAGE_REF}" >/dev/null
fi

info "create remote dirs"
ssh_nas "mkdir -p '${DEPLOY_DIR}' /volume2/Docker_Configs/torzlink /volume1/data/media/descargas/torrents && chown -R 1000:1000 /volume2/Docker_Configs/torzlink 2>/dev/null || true"

TAR="$(mktemp -t torzlink-XXXXXX.tar)"
trap 'rm -f "${TAR}" "${TMP_ENV:-}"' EXIT
info "docker save → transfer → load"
docker save -o "${TAR}" "${IMAGE_REF}"
scp_to "${TAR}" "${DEPLOY_DIR}/torzlink-image.tar"
ssh_nas "docker load -i '${DEPLOY_DIR}/torzlink-image.tar' && rm -f '${DEPLOY_DIR}/torzlink-image.tar'"

info "copy compose assets"
scp_to "${REPO_ROOT}/packaging/docker/docker-compose.nas.yml" "${DEPLOY_DIR}/docker-compose.nas.yml"
scp_to "${REPO_ROOT}/packaging/docker/.env.nas.example" "${DEPLOY_DIR}/.env.nas.example"
scp_to "${REPO_ROOT}/packaging/docker/traefik-gluetun-torzlink.labels.md" "${DEPLOY_DIR}/traefik-gluetun-torzlink.labels.md" || true

TMP_ENV="$(mktemp)"
if ssh_nas "test -f '${DEPLOY_DIR}/.env'"; then
  info "fetch existing remote .env"
  scp_from "${DEPLOY_DIR}/.env" "${TMP_ENV}"
else
  info "create remote .env from example"
  cp "${REPO_ROOT}/packaging/docker/.env.nas.example" "${TMP_ENV}"
fi

set_env_key "${TMP_ENV}" TORZLINK_IMAGE "${IMAGE_REF}"
set_env_key "${TMP_ENV}" TORZLINK_NETWORK_MODE "${NETWORK_MODE}"
set_env_key "${TMP_ENV}" DOCKER_CONFIG_ROOT "/volume2/Docker_Configs"
set_env_key "${TMP_ENV}" MEDIA_ROOT "/volume1/data"
set_env_key "${TMP_ENV}" TORZLINK_DOWNLOADS_HOST "/volume1/data/media/descargas/torrents"
set_env_key "${TMP_ENV}" PUID "1000"
set_env_key "${TMP_ENV}" PGID "1000"
set_env_key "${TMP_ENV}" TZ "Europe/Madrid"

if [[ -n "${PROXY_NET_NAME}" ]]; then
  set_env_key "${TMP_ENV}" PROXY_NET_NAME "${PROXY_NET_NAME}"
elif [[ "${NETWORK_MODE}" == "direct" ]]; then
  existing="$(read_env "${TMP_ENV}" PROXY_NET_NAME || true)"
  if [[ -z "${existing}" ]]; then
    info "remote networks:"
    ssh_nas "docker network ls --format '{{.Name}}'"
    die "set PROXY_NET_NAME=… and re-run"
  fi
fi

LOCAL_ENV="${REPO_ROOT}/.env"
token="$(read_env "${LOCAL_ENV}" TORZLINK_SERVE_TOKEN || true)"
if [[ -z "${token}" ]]; then
  token="$(read_env "${TMP_ENV}" TORZLINK_SERVE_TOKEN || true)"
fi
if [[ -z "${token}" ]]; then
  token="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 32)"
  info "generated TORZLINK_SERVE_TOKEN (saved on NAS .env; copy into local .env to use the UI)"
fi
set_env_key "${TMP_ENV}" TORZLINK_SERVE_TOKEN "${token}"

if [[ "${SKIP_TELEGRAM_SYNC}" != "1" ]]; then
  for k in TELEGRAM_ENABLED TELEGRAM_BOT_TOKEN TELEGRAM_CHANNEL_ID; do
    v="$(read_env "${LOCAL_ENV}" "${k}" || true)"
    [[ -n "${v}" ]] && set_env_key "${TMP_ENV}" "${k}" "${v}"
  done
fi

scp_to "${TMP_ENV}" "${DEPLOY_DIR}/.env"
ssh_nas "chmod 600 '${DEPLOY_DIR}/.env'"

GLUETUN_NAME="$(read_env "${TMP_ENV}" GLUETUN_CONTAINER_NAME || true)"
GLUETUN_NAME="${GLUETUN_NAME:-${GLUETUN_CONTAINER_NAME:-gluetun}}"

info "compose up on NAS"
ssh_nas "bash -s" <<EOF
set -e
cd '${DEPLOY_DIR}'
docker compose --env-file .env --profile direct -f docker-compose.nas.yml down 2>/dev/null || true
docker compose --env-file .env --profile vpn -f docker-compose.nas.yml down 2>/dev/null || true
if [ '${NETWORK_MODE}' = 'vpn' ]; then
  docker inspect -f '{{.State.Running}}' '${GLUETUN_NAME}' 2>/dev/null | grep -qx true \
    || { echo "gluetun '${GLUETUN_NAME}' not running"; exit 1; }
fi
docker compose --env-file .env --profile '${NETWORK_MODE}' -f docker-compose.nas.yml up -d
docker ps --filter name=^torzlink\$ --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
EOF

info "done → http://torzlink.lan (Bearer token required on /api/*)"
