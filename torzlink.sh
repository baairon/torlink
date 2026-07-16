#!/usr/bin/env bash
# Keep in sync with torzlink.ps1 — see docs/follow-ups-launchers.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

mode=""

case "${1:-}" in
  --native|-n|1) mode=native ;;
  --docker|-d|2) mode=docker ;;
  --web|-w|3) mode=web ;;
esac

show_menu() {
  echo "TorZlink — launcher"
  echo "  1) Native (Node.js TUI, local development)"
  echo "  2) Docker (interactive TUI container)"
  echo "  3) Web UI (torzlink serve)"
  echo "  q) Exit"
}

resolve_mode_from_menu() {
  while true; do
    show_menu
    read -r -p "Choose [1/2/3/q]: " pick
    case "$pick" in
      1) mode=native; break ;;
      2) mode=docker; break ;;
      3) mode=web; break ;;
      q|Q) exit 0 ;;
      *)
        echo "Invalid option. Use 1, 2, 3, or q." >&2
        ;;
    esac
  done
}

if [[ -z "$mode" ]]; then
  if [[ -t 0 ]]; then
    resolve_mode_from_menu
  else
    echo "No TTY. Use --native, --docker, or --web." >&2
    exit 1
  fi
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$2" >&2
    exit 1
  fi
}

warn_env_placeholders() {
  local env_path="$ROOT/.env"
  [[ -f "$env_path" ]] || return 0
  if grep -qE 'your-bot-token|123456789:ABCdefGHI|@mi_canal|@your_channel' "$env_path" 2>/dev/null; then
    echo "Warning: .env contains placeholder values from .env.example." >&2
    echo "Replace TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID with real credentials." >&2
    echo "Do not enable Telegram with example or placeholder tokens." >&2
    echo ""
  fi
}

run_native() {
  require_command node "Node.js not found. Install Node 22+ (see README)."
  require_command npm "npm not found. Install Node 22+ (see README)."
  warn_env_placeholders
  npm run launch
}

run_web() {
  require_command node "Node.js not found. Install Node 22+ (see README)."
  require_command npm "npm not found. Install Node 22+ (see README)."
  warn_env_placeholders
  npm run serve
}

ensure_docker_env_file() {
  local env_path="$ROOT/.env"
  if [[ -f "$env_path" ]]; then
    return 0
  fi

  echo ""
  echo ".env not found (optional — only needed for Telegram notifications)."
  echo "Docker Compose requires the file to exist."

  if [[ -t 0 ]]; then
    read -r -p "Create empty .env and continue? [Y/n]: " answer
    case "$answer" in
      n|N)
        echo "Docker launch cancelled. Copy .env.example to .env or create an empty .env file." >&2
        exit 1
        ;;
    esac
  else
    echo "Creating empty .env (non-interactive mode)." >&2
  fi

  : >"$env_path"
  echo "Created empty .env at $env_path"
  if [[ -f "$ROOT/.env.example" ]]; then
    echo "Tip: copy settings from .env.example, then replace every placeholder with real values."
    echo "Never enable Telegram with the example bot token or channel name."
  fi
  echo ""
}

run_docker() {
  require_command docker "Docker not found. Install Docker Desktop or Docker Engine (see README)."
  if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose not found. Install Docker Compose v2 (see README)." >&2
    exit 1
  fi
  ensure_docker_env_file
  warn_env_placeholders
  docker compose -f packaging/docker/docker-compose.yml build --quiet torzlink
  docker compose -f packaging/docker/docker-compose.yml run --rm -it torzlink
}

case "$mode" in
  docker) run_docker ;;
  web) run_web ;;
  *) run_native ;;
esac
