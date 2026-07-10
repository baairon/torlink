# Changelog

All notable changes in [TiiZss/TorZlink](https://github.com/TiiZss/TorZlink) compared to the upstream [baairon/torlink](https://github.com/baairon/torlink) fork base.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.4.0] — 2026-07-10

Major fork release: rebrand to **TorZlink** / `torzlink`, repo restructure, optional Telegram notifications, root launchers, electric blue theme, and Docker polish.

**Verified:** full test suite; `npm run build`; `npm run test:launchers`; Docker image `torzlink:latest`.

### Added

- **Rebrand** — UI/docs use **TorZlink**; npm binary and Docker image use `torzlink` (no `torlnk` alias)
- **TorZlink wordmark** — updated logo art in `src/ui/lib/logo.ts`
- **Electric blue theme** — accent palette, logo sheen, progress bar, and README previews
- **UTF-8 baseline** — `.editorconfig`, `.gitattributes`, `LANG=C.UTF-8` in Docker; explicit `utf8` on file I/O
- **`.env` support** — `dotenv` loads `.env` from cwd; see `.env.example`
- **Telegram notifications** (optional) — magnet copied, download started/completed/failed via Bot API
- **Named magnet files** — in Docker/headless, `y` (copy) and `d` (download) write `{torrent-name}.magnet` under downloads (not a single `magnet.txt`)
- **Root launcher scripts** — `torzlink.sh`, `torzlink.ps1`, and `torzlink.cmd` with an interactive menu (native vs Docker); optional `--native` / `--docker` flags to skip the menu; prompts to create empty `.env` before Docker when missing; Docker path calls `docker compose` directly (no Node/npm required)
- **Launcher smoke tests** — `tools/test-launchers.sh` and CI `launchers` job (bash on Ubuntu, pwsh on Windows)
- **Repo layout** — `src/app/entry.tsx`, `src/integrations/`, `assets/preview/`, `packaging/docker/`, `tools/`, `tests/` mirror
- **Migration** — `TORZLINK_*` env vars with fallback to legacy `TORLINK_*` / `TORLNK_SKIP_UPDATE`; state dir falls back to upstream `torlink` data if present
- **Docker truecolor** — `bootstrap-terminal-env.ts`, compose/Dockerfile env (`COLORTERM=truecolor`, `FORCE_COLOR=3`) for correct logo colors in containers
- **Tests** — `env.test.ts`, `telegram.test.ts`, `magnet-file.test.ts`; updated clipboard fallback tests; `ensure.test.cjs` audit helpers

### Changed

- Default download folder: `~/Downloads/torzlink`
- Docker Compose service/image: `torzlink:latest`; `env_file: .env` for Telegram
- `npm run docker:run` and launchers rebuild quietly (`build --quiet`) before `run --rm -it`
- Queue `completed` / `failed` events now pass the full queue item (for notifications)
- **`ensure.cjs`** — runs `npm audit fix` for semver-safe vulnerability fixes (audit output remains visible)

### Fixed

- **Docker logo colors** — gray banding on wordmark sheen when PTY lacked truecolor support
- **Stale Docker image** — launchers rebuild image when sources change

### Security

- `.env` gitignored; bot token never logged
- Telegram sends are fire-and-forget (errors to stderr only)

### Planned

- Manual smoke test: interactive download in Docker TUI on Windows host
- Optional non-interactive mode for magnet-only workflows
- Launcher follow-ups: see [docs/follow-ups-launchers.md](docs/follow-ups-launchers.md)

## [1.3.0] — 2026-07-09

Fork maintenance release: developer experience, Docker support, and runtime hardening on top of upstream `1.3.0`.

**Verified:** 120 tests passing; Docker image builds on Windows; TTY guard and `--version` work in container.

### Added

- **`scripts/ensure.cjs`** — checks Node.js ≥ 22, installs missing dependencies, and updates outdated packages on every `npm run dev` / `npm start` / `npm run launch`
- **`npm run launch`** — one-command local development entry point
- **`.nvmrc` / `.node-version`** — Node 22 pin for nvm, fnm, and volta
- **`TORLNK_SKIP_UPDATE=1`** — skip dependency self-update (CI and Docker)
- **Docker** — multi-stage `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `npm run docker:build`, `npm run docker:run`
- **Environment overrides**
  - `TORLINK_STATE_DIR` — config, history, and clipboard fallback location
  - `TORLINK_DOWNLOAD_DIR` — default download folder
  - `TORLINK_DISABLE_NAT=1` — disable NAT-PMP, UPnP, and uTP (Docker / restricted networks)
  - `TORLINK_CLIPBOARD_FILE` — explicit clipboard fallback path
- **Headless clipboard fallback** — when `xclip`/`wl-copy` are unavailable, magnets are written to `$TORLINK_STATE_DIR/clipboard.txt`
- **TTY guard** — clear error when Ink cannot enter raw mode (non-interactive Docker)
- **`useSafeInput` hook** — avoids Ink crashes when stdin is not a TTY
- **CI** — GitHub Actions matrix on Linux, macOS, and Windows; Docker image build job
- **Release workflow** — tag `v*` triggers tests, GHCR image push, and GitHub Release
- **Tests** — `scripts/ensure.test.cjs`, `clipboard.fallback.test.ts`, Docker NAT opts in `engine.test.ts`

### Changed

- Repository metadata points to `TiiZss/TorZlink`
- Docker image tag standardized to `torlnk:latest`
- `webTorrentClientOpts()` disables NAT traversal inside containers (`/.dockerenv` or `TORLINK_DISABLE_NAT`)

### Fixed

- **Docker build** — `node_datachannel.node` missing because `--ignore-scripts` skipped native postinstalls in the deps stage
- **Docker downloads** — segfault (exit 139) when starting torrents; resolved by disabling NAT-PMP, UPnP, and uTP in container environments
- **Docker clipboard** — copy-magnet failed without DISPLAY; fallback file now works
- **Docker paths** — downloads and state now respect volume-mounted directories via env vars
- **Ink raw mode** — `Raw mode is not supported` when running without `-it`; documented and guarded at startup
- **Node check** — `checkNode()` always runs before `TORLNK_SKIP_UPDATE` early return
- **Review** — removed debug telemetry (`agent-log`) from production code paths

### Security

- No outbound debug logging in production builds

---

## Upstream baseline

This fork is based on [baairon/torlink](https://github.com/baairon/torlink) **v1.3.0**, which includes:

- Terminal UI (Ink) for search, browse, download, and seeding
- Curated sources: FitGirl, YTS, TPB, 1337x, EZTV, Nyaa, SubsPlease
- Background downloads with resume and automatic seeding
- Cross-platform clipboard for magnet links
- Self-update of the published `torlnk` npm package on startup

See upstream commit history for features predating this fork. Original author: [bairon (@baairon)](https://github.com/baairon).
