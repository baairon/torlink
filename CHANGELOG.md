# Changelog

All notable changes in [TiiZss/TorZlink](https://github.com/TiiZss/TorZlink) compared to the upstream [baairon/torlink](https://github.com/baairon/torlink) fork base.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.7.1] — 2026-07-16

NAS download path + ownership fix, deploy-from-dev hardening, and stricter duplicate-download API.

### Fixed

- **NAS downloads mount** — bind to `TORZLINK_DOWNLOADS_HOST` (default `/volume1/data/media/descargas/torrents`) instead of a separate `media/torzlink` tree
- **Container UID** — compose runs as `PUID:PGID` (default `1000:1000`) so the process can write shared media mounts (image default uid 100 caused `EACCES`)
- **`deploy-from-dev.ps1`** — fetch remote `.env` via `plink`+`cat` (pscp fails on absolute Linux paths); Gluetun check uses bash `if/fi` so PowerShell never parses remote braces; safer `docker ps` format quoting; write `.env` as UTF-8 without BOM/LF; wipe temp `.env` in `finally`
- **`deploy-nas.sh up`** — skip `compose pull` for local image tags (`torzlink:vX`); migrate legacy `TORZLINK_IMAGE_TAG` → `TORZLINK_IMAGE`; `chown` data dir to `PUID:PGID` on install
- **POST `/api/downloads`** — returns **409** when the infohash is already in the queue (non-failed), instead of silently re-adding

### Changed

- **`.env.nas.example` / deploy scripts** — set `TORZLINK_DOWNLOADS_HOST`, `PUID=1000`, `PGID=1000`; chown `/data` on deploy so upgrades from image uid 100 keep queue persistence
- **README** — NAS path table + Traefik Docker API compatibility note (`DOCKER_API_VERSION` / `traefik:v3.6`) after Engine upgrades that break the Docker provider

## [1.7.0] — 2026-07-16

Web UI + NAS/Traefik deploy: LAN search and download queue in the browser, with optional Gluetun VPN mode.

**Verified:** 162 tests; `npm run typecheck`; `npm run build`; security + bugbot review on uncommitted changes.

### Added

- **Web UI + API** — `torzlink serve [--host] [--port]`: search all sources and manage the download queue in the browser (`web/`, `GET /api/search`, `/api/downloads`); optional `TORZLINK_SERVE_TOKEN` Bearer auth on `/api/*`
- **NAS deploy** — [packaging/docker/docker-compose.nas.yml](packaging/docker/docker-compose.nas.yml) for Traefik v3; `TORZLINK_NETWORK_MODE=direct|vpn`; [tools/deploy-nas.sh](tools/deploy-nas.sh); Gluetun label snippet
- **Shared runtime bootstrap** — `createTorzlinkRuntime()` for TUI and serve
- **Agent workflow** — [docs/agent-workflow.md](docs/agent-workflow.md): proactive skill routing, security/bugbot gates before tags, `npm run pre-release`, CI monitoring guidance
- **`tools/pre-release-check.sh`** — lockfile/Docker/SBOM invariants + test/build/docker smoke
- **Cursor rule templates** — [docs/cursor-rules/](docs/cursor-rules/); install with `npm run cursor:rules`

### Changed

- **ADR-001** — trust model documents LAN HTTP admin API and optional Gluetun VPN mode (no longer TTY-only)

## [1.6.0] — 2026-07-11

Security hardening release: P0 supply-chain and download-boundary controls plus P1 tracker warnings, trust model ADR, regression tests, and release SBOM.

**Verified:** 151 tests; `npm run typecheck`; `npm run build`; CI security job (Gitleaks, npm audit critical, Trivy).

### Added

- **CI security job** — Gitleaks secrets scan, `npm audit` (blocks critical), Trivy filesystem and Docker image scans
- **`package-lock.json`** — versioned for reproducible installs; CI, release, and Docker use `npm ci`
- **Magnet sanitization** — `sanitizeDownloadInput()` / `sanitizeMagnetInput()` rebuild magnets from validated infoHashes before WebTorrent
- **`safeDisplayText()`** — strips terminal control characters from scraped names shown in the TUI
- **Launcher `.env` warnings** — detect placeholder Telegram tokens/channels in `.env` before native or Docker launch
- **Custom tracker warnings** — unknown tracker hostnames flagged when saving extra announce URLs
- **ADR-001** — trust model document at [docs/adr/001-trust-model.md](docs/adr/001-trust-model.md)
- **Security regression tests** — poisoned magnets and terminal-injection labels in `tests/security/regression.test.ts`
- **Release SBOM** — CycloneDX SBOM generated on tag releases and attached to GitHub Release

### Security

- Download boundary no longer passes raw scraped magnet URIs to WebTorrent when a canonical rebuild is possible
- TUI notices and lists use `safeDisplayText()` for external-source titles
- Saving custom trackers warns when announce URLs point to hosts outside the known-public list
- `.env.example` keeps Telegram variables commented by default (from v1.5.0 baseline)

### Fixed

- **Release pipeline** — `.dockerignore` no longer excludes `package-lock.json` (required by `npm ci` in the Dockerfile); SBOM step redirects `npm sbom` stdout to `sbom.cdx.json` (CLI has no `-o` flag)

## [1.5.0] — 2026-07-10

Telegram notification polish and security roadmap documentation.

**Verified:** full test suite; `npm run typecheck`; `npm run build`.

### Changed

- **Telegram notifications** — copy and download start send the magnet as a `.magnet` document attachment (caption shows title and folder only). Completion posts a summary (size, file count, elapsed time, average speed) without the magnet URI. Errors omit the magnet text.
- **README project board** — security hardening backlog (P0/P1/P2) and fork roadmap columns

### Added

- **`magnetAttachmentFilename()`** — shared basename helper for Telegram attachments and magnet sidecar files

### Security

- `.env.example` — Telegram variables commented by default (enable only with real credentials)

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
