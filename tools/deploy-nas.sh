#!/usr/bin/env bash
# Deploy TorZlink web UI on a Docker NAS (Ugreen / Traefik v3).
# Run on the NAS (SSH). See packaging/docker/.env.nas.example
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/packaging/docker/docker-compose.nas.yml"
ENV_EXAMPLE="${REPO_ROOT}/packaging/docker/.env.nas.example"

DEPLOY_DIR="${TORZLINK_DEPLOY_DIR:-${PWD}}"
ENV_FILE="${DEPLOY_DIR}/.env"

die() { echo "error: $*" >&2; exit 1; }
info() { echo "→ $*"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

load_env() {
  if [[ -f "${ENV_FILE}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
  fi
  # Migrate v1.7.0-style TORZLINK_IMAGE_TAG → TORZLINK_IMAGE (persist for --env-file)
  if [[ -z "${TORZLINK_IMAGE:-}" && -n "${TORZLINK_IMAGE_TAG:-}" ]]; then
    export TORZLINK_IMAGE="ghcr.io/tiizss/torzlink:${TORZLINK_IMAGE_TAG}"
    if [[ -f "${ENV_FILE}" ]] && ! grep -qE '^[[:space:]]*TORZLINK_IMAGE=' "${ENV_FILE}"; then
      printf '\nTORZLINK_IMAGE=%s\n' "${TORZLINK_IMAGE}" >> "${ENV_FILE}"
    fi
    info "derived TORZLINK_IMAGE=${TORZLINK_IMAGE} from TORZLINK_IMAGE_TAG"
  fi
}

mode_profile() {
  local mode="${TORZLINK_NETWORK_MODE:-direct}"
  case "${mode}" in
    direct|vpn) echo "${mode}" ;;
    *) die "TORZLINK_NETWORK_MODE must be 'direct' or 'vpn' (got: ${mode})" ;;
  esac
}

compose() {
  local profile
  profile="$(mode_profile)"
  docker compose --env-file "${ENV_FILE}" --profile "${profile}" -f "${COMPOSE_FILE}" "$@"
}

cmd_install() {
  need_cmd docker
  mkdir -p "${DEPLOY_DIR}"
  if [[ ! -f "${ENV_FILE}" ]]; then
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    chmod 600 "${ENV_FILE}" || true
    info "created ${ENV_FILE} — edit PROXY_NET_NAME / TORZLINK_NETWORK_MODE then re-run"
  else
    chmod 600 "${ENV_FILE}" || true
    info "using existing ${ENV_FILE}"
  fi
  load_env
  local data_dir="${DOCKER_CONFIG_ROOT:-/volume2/Docker_Configs}/torzlink"
  local dl_dir="${TORZLINK_DOWNLOADS_HOST:-${MEDIA_ROOT:-/volume1/data}/media/descargas/torrents}"
  local puid="${PUID:-1000}"
  local pgid="${PGID:-1000}"
  mkdir -p "${data_dir}" "${dl_dir}"
  chown -R "${puid}:${pgid}" "${data_dir}" 2>/dev/null || true
  info "data: ${data_dir} (owner ${puid}:${pgid})"
  info "downloads: ${dl_dir}"
  info "mode: ${TORZLINK_NETWORK_MODE:-direct}"
  if [[ "${TORZLINK_NETWORK_MODE:-direct}" == "direct" && -z "${PROXY_NET_NAME:-}" ]]; then
    info "hint: set PROXY_NET_NAME from: docker network ls"
  fi
  if [[ "${TORZLINK_NETWORK_MODE:-direct}" == "vpn" ]]; then
    info "vpn mode: paste Traefik labels from packaging/docker/traefik-gluetun-torzlink.labels.md onto gluetun"
  fi
  info "DNS: point torzlink.lan at Traefik LAN IP (e.g. 192.168.1.2)"
  info "next: $(basename "$0") up"
}

cmd_up() {
  need_cmd docker
  [[ -f "${ENV_FILE}" ]] || die "missing ${ENV_FILE} — run: $(basename "$0") install"
  load_env
  local profile
  profile="$(mode_profile)"
  if [[ "${profile}" == "direct" ]]; then
    [[ -n "${PROXY_NET_NAME:-}" ]] || die "PROXY_NET_NAME is required for direct mode"
  fi
  if [[ "${profile}" == "vpn" ]]; then
    local g="${GLUETUN_CONTAINER_NAME:-gluetun}"
    docker inspect -f '{{.State.Running}}' "${g}" 2>/dev/null | grep -qx true \
      || die "gluetun container '${g}' is not running"
  fi
  # Tear down the other profile so only one torzlink exists
  if [[ "${profile}" == "direct" ]]; then
    docker compose --env-file "${ENV_FILE}" --profile vpn -f "${COMPOSE_FILE}" down 2>/dev/null || true
  else
    docker compose --env-file "${ENV_FILE}" --profile direct -f "${COMPOSE_FILE}" down 2>/dev/null || true
  fi
  local img="${TORZLINK_IMAGE:-ghcr.io/tiizss/torzlink:latest}"
  # Local tags from deploy-from-dev (no slash) are not in a registry — skip pull.
  if [[ "${img}" == */* ]]; then
    compose pull
  else
    info "skip registry pull for local image: ${img}"
  fi
  compose up -d
  info "TorZlink up (profile=${profile}). Open http://torzlink.lan"
}

cmd_update() {
  cmd_up
}

cmd_down() {
  need_cmd docker
  [[ -f "${ENV_FILE}" ]] || die "missing ${ENV_FILE}"
  load_env
  docker compose --env-file "${ENV_FILE}" --profile direct -f "${COMPOSE_FILE}" down 2>/dev/null || true
  docker compose --env-file "${ENV_FILE}" --profile vpn -f "${COMPOSE_FILE}" down 2>/dev/null || true
  info "stopped"
}

cmd_logs() {
  need_cmd docker
  [[ -f "${ENV_FILE}" ]] || die "missing ${ENV_FILE}"
  load_env
  compose logs -f --tail=200
}

cmd_status() {
  need_cmd docker
  load_env || true
  echo "deploy dir: ${DEPLOY_DIR}"
  echo "env file:   ${ENV_FILE} $([ -f "${ENV_FILE}" ] && echo OK || echo MISSING)"
  echo "mode:       ${TORZLINK_NETWORK_MODE:-direct (default)}"
  echo "compose:    ${COMPOSE_FILE}"
  docker ps --filter "name=^torzlink$" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}" 2>/dev/null || true
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx torzlink; then
    docker exec torzlink wget -qO- http://127.0.0.1:8787/health 2>/dev/null \
      || docker exec torzlink node -e "fetch('http://127.0.0.1:8787/health').then(r=>r.text()).then(console.log).catch(e=>{console.error(e);process.exit(1)})" 2>/dev/null \
      || info "container up but /health not reachable yet"
  fi
}

cmd_uninstall() {
  cmd_down
  if [[ "${1:-}" == "--purge" ]]; then
    load_env
    local data_dir="${DOCKER_CONFIG_ROOT:-/volume2/Docker_Configs}/torzlink"
    info "removing ${data_dir} (downloads kept)"
    rm -rf "${data_dir}"
  else
    info "data/downloads kept; pass --purge to delete state under DOCKER_CONFIG_ROOT/torzlink"
  fi
}

usage() {
  cat <<EOF
usage: $(basename "$0") <command>

  install     create .env + data/download dirs
  up          pull image and start (honours TORZLINK_NETWORK_MODE)
  update      same as up
  down        stop containers
  logs        follow logs
  status      mode, container, health
  uninstall [--purge]

Env: TORZLINK_DEPLOY_DIR (default: cwd) points at the directory holding .env
EOF
}

main() {
  local cmd="${1:-}"
  shift || true
  case "${cmd}" in
    install) cmd_install "$@" ;;
    up) cmd_up "$@" ;;
    update) cmd_update "$@" ;;
    down) cmd_down "$@" ;;
    logs) cmd_logs "$@" ;;
    status) cmd_status "$@" ;;
    uninstall) cmd_uninstall "$@" ;;
    -h|--help|help|"") usage ;;
    *) die "unknown command: ${cmd}" ;;
  esac
}

main "$@"
