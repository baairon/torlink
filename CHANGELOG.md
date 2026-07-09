# Changelog

All notable changes in [TiiZss/TorZlink](https://github.com/TiiZss/TorZlink) compared to the upstream [baairon/torlink](https://github.com/baairon/torlink) fork base.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Planned

- Manual smoke test: interactive download in Docker TUI on Windows host
- Optional non-interactive mode for magnet-only workflows

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

See upstream commit history for features predating this fork.
