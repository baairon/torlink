<p align="center">
  <img src="assets/preview/splash.svg" alt="TorZlink — curated torrents straight from your terminal" style="max-width: 832px; width: 100%; height: auto;">
</p>

Finding a torrent these days sucks. One site is a minefield of fake download buttons. Another hides the real link under a popup that spawns two more tabs. And after all that, half the results are dead, zero seeders.

TorZlink is a torrent finder that lives in your terminal, with zero setup and nothing to configure. One search checks a short, curated list of reputable sources at once, and whatever you pick downloads straight to your computer. The files are yours, saved to your downloads folder.

> **This repository** — [TiiZss/TorZlink](https://github.com/TiiZss/TorZlink) is a maintained fork of [baairon/torlink](https://github.com/baairon/torlink) by [bairon (@baairon)](https://github.com/baairon). Same TUI and sources; this fork adds Docker, auto-setup for developers, CI, and fixes for headless/container environments. See [Differences from upstream](#differences-from-upstream), [Acknowledgments](#acknowledgments), and the [Changelog](CHANGELOG.md).

## Get started

1. **Install Node** (from [nodejs.org](https://nodejs.org)), it's all TorZlink needs.
2. **Open your terminal.**
3. **Start it:**

   ```sh
   npx torzlink
   ```

That's the only thing you'll type. TorZlink opens straight to a search bar: search for what you want, paste in a magnet link or a bare infohash, or just press Enter on an empty box to browse the curated library. From there it's all keypresses, nothing to memorize, and `?` brings up the full list anytime.

## Finding something

Type what you're looking for and press Enter. Results stream in from every source as they answer, tagged with size and how many people are sharing each one, so you can see what'll come down fast. Arrow to what you want and press `d` to save it, or `shift+d` to pick a different folder for just that download.

<p align="center">
  <img src="assets/preview/browse.svg" alt="TorZlink browse view: the sidebar, the search bar, and merged results from every source" style="max-width: 832px; width: 100%; height: auto;">
</p>

## Your downloads

Active downloads sit up top with their progress, speed, and time left; when one finishes it drops into Recently downloaded just below, so the list stays tidy. Everything's still there when you come back, and anything interrupted picks up where it left off.

Downloads run in the background while you keep searching, so you can queue up as many as you want. They save to your downloads folder, and the Downloads pane keeps tabs on each one; press `o` anytime to change where that is, or grab one result with `shift+d` to send it somewhere else without touching the default. When something finishes it keeps seeding automatically so the next person can find it too, and the Seeding tab lets you pause or stop that anytime.

<p align="center">
  <img src="assets/preview/downloads.svg" alt="TorZlink Downloads pane: live progress on top, recently downloaded below" style="max-width: 832px; width: 100%; height: auto;">
</p>

## What it searches

A short, hand-picked list of trusted sources:

| Category | Sources |
| --- | --- |
| Games | FitGirl |
| Movies | YTS, The Pirate Bay, 1337x |
| TV | EZTV, The Pirate Bay, 1337x |
| Anime | Nyaa, SubsPlease |

Games are the only category that can run code, so they come from FitGirl alone, a repacker with a long, trusted track record; everything else is plain video and subtitles. If a source is down, the search carries on without it, and TorZlink tells you which one is offline.

## Differences from upstream

Fork of [baairon/torlink](https://github.com/baairon/torlink). Core behaviour (search, download, seed, UI) is unchanged unless noted.

| Area | Upstream (`baairon/torlink`) | This fork (`TiiZss/TorZlink`) |
| --- | --- | --- |
| **Run locally** | `npm install` then `npm run dev` | `npm run launch` + auto `ensure` on `dev`/`start` (Node check, install, update deps) |
| **Node version** | Documented ≥ 22 | `.nvmrc` / `.node-version` + enforced in `ensure.cjs` |
| **Docker** | Not provided | Multi-stage image, `docker-compose.yml`, `npm run docker:run` |
| **Download directory** | OS default only | `TORZLINK_DOWNLOAD_DIR` (legacy `TORLINK_*` supported) |
| **State / config dir** | `env-paths` default | `TORZLINK_STATE_DIR` override; migrates from upstream `torlink` data |
| **Clipboard (copy magnet)** | OS clipboard (`xclip`, etc.) | Same + **named `.magnet` files** in downloads when headless/Docker |
| **WebTorrent in Docker** | N/A | NAT-PMP, UPnP, uTP disabled (`TORZLINK_DISABLE_NAT` / `/.dockerenv`) |
| **Telegram** | N/A | Optional notifications via `.env` (copy, start, complete, error) |
| **Self-update** | npm package update on `torlnk` binary | `torzlink` binary; `TORZLINK_SKIP_UPDATE=1` in Docker/CI |
| **Repository** | `baairon/torlink` | `TiiZss/TorZlink` |

Full version history: [CHANGELOG.md](CHANGELOG.md).

## Quick launch

After cloning, run the root launcher — it shows a menu to pick **native** (Node.js) or **Docker**:

| OS | Command |
|----|---------|
| Windows (double-click or cmd) | `torzlink.cmd` |
| Windows (PowerShell) | `.\torzlink.ps1` |
| macOS / Linux | `./torzlink.sh` |

```
TorZlink — launcher
  1) Native (Node.js, local development)
  2) Docker (interactive container)
  q) Exit

Choose [1/2/q]:
```

Skip the menu in scripts or CI: `./torzlink.sh --native`, `.\torzlink.ps1 -Docker`, etc.

If `.env` is missing when you pick Docker, the launcher offers to create an empty file (Telegram is optional; see `.env.example`).

On Unix, make the shell script executable once: `chmod +x torzlink.sh`.

## Contributing

To run or work on TorZlink locally:

1. Clone the repository and open the folder:

   ```sh
   git clone https://github.com/TiiZss/TorZlink
   cd TorZlink
   ```

2. **Use Node 22+** (`.nvmrc` / `.node-version` are included for nvm, fnm, or volta).
3. Launch with auto-setup (installs and updates dependencies on every start):

   ```sh
   ./torzlink.sh          # menu: native or Docker
   npm run launch         # native only
   ```

   Or the classic flow:

   ```sh
   npm install
   npm run dev
   ```

   `npm run dev` and `npm start` also run the ensure step automatically (`predev` / `prestart`), which checks Node, installs missing packages, and updates outdated ones. Set `TORZLINK_SKIP_UPDATE=1` to skip updates (useful in CI).

4. Or build it and run the bundled version:

   ```sh
   npm run build
   npx torzlink
   ```

   The `torzlink` binary checks for newer releases on startup and updates itself when possible.

Save `.env` and source files as **UTF-8** (no BOM on Windows).

### Telegram (optional)

Copy `.env.example` to `.env` and set:

```env
TELEGRAM_ENABLED=1
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHANNEL_ID=@your_channel
```

The bot must be an **admin** of the channel to post. TorZlink notifies on magnet copy (`y`), download start (`d`), completion, and errors. Telegram failures are logged to stderr only — the TUI keeps running.

`docker-compose.yml` loads `.env` automatically via `env_file`.

### Docker

Interactive TUI (downloads persist in `./downloads`, state in a named volume):

```sh
npm run docker:run
```

(`docker:run` runs `build --quiet` then `run --rm -it` with the required TTY flags. Without `-it`, Ink cannot read keyboard input.)

Equivalent manual steps:

```sh
docker compose -f packaging/docker/docker-compose.yml build --quiet torzlink
docker compose -f packaging/docker/docker-compose.yml run --rm -it torzlink
```

**Docker Desktop:** `docker compose run --rm` creates a one-off container (name like `torzlink-torzlink-run-…`) that only appears under **Containers** while the TUI is running. When you quit or the app exits, `--rm` removes it immediately — that is expected, not a bug.

Build the image manually (tags it as `torzlink:latest`):

```sh
docker build -f packaging/docker/Dockerfile -t torzlink:latest .
docker run --rm -it \
  -e TORZLINK_STATE_DIR=/data \
  -e TORZLINK_DOWNLOAD_DIR=/downloads \
  -v torzlink-data:/data \
  -v "%cd%/downloads:/downloads" \
  torzlink:latest
```

On Linux/macOS, replace `%cd%` with `$(pwd)`.

Before opening a PR, skim [CONTRIBUTING.md](CONTRIBUTING.md); it lays out the bar with examples from real merged PRs.

## Troubleshooting

Problems encountered while building and running this fork, and how they were fixed.

### Docker build fails: `node_datachannel.node` not found

**Symptom:** Image build or runtime error about a missing native module under `node-datachannel`.

**Cause:** `npm install --ignore-scripts` in the production deps stage skipped postinstall scripts that compile the native binary.

**Fix:** The deps stage runs `npm install --omit=dev` **without** `--ignore-scripts`, and verifies the `.node` file exists. Rebuild:

```sh
docker compose -f packaging/docker/docker-compose.yml build --no-cache
```

### `torzlink:latest` not found

**Symptom:** `docker run torzlink:latest` fails with image not found.

**Fix:** Build first (`docker compose -f packaging/docker/docker-compose.yml build` or `docker build -f packaging/docker/Dockerfile -t torzlink:latest .`). Compose and `npm run docker:build` tag the image as `torzlink:latest`.

### `Raw mode is not supported` (Ink / stdin)

**Symptom:** App exits immediately with an Ink error about raw mode.

**Cause:** Container or pipe started **without a TTY** (`-t` / `-i`).

**Fix:** Always use interactive mode:

```sh
npm run docker:run
# or
docker compose -f packaging/docker/docker-compose.yml build --quiet torzlink
docker compose -f packaging/docker/docker-compose.yml run --rm -it torzlink
```

The app also prints this hint at startup if stdin/stdout are not TTYs.

### Logo colors look wrong in Docker (gray banding)

**Symptom:** The wordmark sheen looks washed out or gray in Docker, but correct when running natively.

**Cause:** Docker PTYs often report 256-color mode without `COLORTERM=truecolor`, so Ink/chalk quantize hex theme colors.

**Fix:** Already set in `docker-compose.yml`, the Dockerfile, and `bootstrap-terminal-env.ts` (`COLORTERM=truecolor`, `FORCE_COLOR=3`). Rebuild the image after pulling updates:

```sh
docker compose -f packaging/docker/docker-compose.yml build --quiet torzlink
```

### App crashes when starting a download in Docker (exit 139)

**Symptom:** Segfault or silent exit when adding a magnet/torrent inside Docker.

**Cause:** WebTorrent's NAT-PMP, UPnP, and uTP native bindings misbehave in restricted container networks.

**Fix:** Set `TORZLINK_DISABLE_NAT=1` (already default in `docker-compose.yml` and the Dockerfile).

### Copy magnet fails in Docker

**Symptom:** "Couldn't copy magnet" after `y`.

**Cause:** No X11 `DISPLAY`; `xclip` cannot reach a desktop clipboard.

**Fix:** Magnet text is written to **`./downloads/{torrent-name}.magnet`** on your host (sanitized title; collision adds a short info-hash suffix). In Docker there is no desktop clipboard — the `.magnet` file in `downloads` is the copy.

### Downloads not appearing on the host

**Symptom:** Download completes in the TUI but files are not in your project folder.

**Cause:** Default download path inside the container is not the mounted volume.

**Fix:** Ensure `TORZLINK_DOWNLOAD_DIR=/downloads` and mount `./downloads:/downloads` (as in `docker-compose.yml`).

### `TorZlink requires Node.js v22 or later`

**Symptom:** Ensure script exits before starting.

**Fix:** Install Node 22+ or run `nvm use` / `fnm use` (`.nvmrc` is set to `22`).

### Dependency update on every start (slow CI or Docker)

**Symptom:** `ensure.cjs` runs `npm update` when you only want to run tests.

**Fix:** `TORZLINK_SKIP_UPDATE=1` (CI and Docker already set this). Node version is still checked.

### macOS: crash when download starts (upstream behaviour)

**Symptom:** Uncaught exception related to NAT-PMP / `EADDRINUSE` on port 5350.

**Cause:** macOS `mDNSResponder` holds the NAT-PMP port; upstream disables `natPmp` on darwin only.

**Fix:** Already handled in `webTorrentClientOpts()` for `process.platform === "darwin"`. Keep Node and dependencies updated.

## Project board

Status of fork work and what comes next.

```mermaid
kanban
  title TorZlink — fork roadmap
  column Done
    Auto-setup script ensure.cjs + npm run launch
    Node 22 pin .nvmrc / .node-version
    Docker multi-stage Dockerfile + compose
    Fix node_datachannel native build in image
    TORZLINK_DOWNLOAD_DIR and TORZLINK_STATE_DIR
    Headless clipboard fallback file
    Disable NAT/UTP in Docker TORZLINK_DISABLE_NAT
    TTY guard and useSafeInput for Ink
    CI matrix Linux macOS Windows + Docker job
    Release workflow GHCR + GitHub Releases on tag
    Remove debug telemetry from production
    Repository metadata → TiiZss/TorZlink
    README troubleshooting and changelog
    Docker build + smoke tests on Windows host
    Root launchers torzlink.sh ps1 cmd + CI smoke
    TorZlink wordmark + electric blue theme
    Docker truecolor bootstrap + quiet rebuild
    Tag v1.4.0 release
  column Planned
    Manual interactive download test in Docker TUI
    Windows-specific Docker volume docs
    Optional headless magnet-add CLI mode
    Sync selective upstream fixes from baairon/torlink
```

| Status | Item |
| --- | --- |
| ✅ Done | Developer auto-setup (`ensure.cjs`, `predev`/`prestart`, `npm run launch`) |
| ✅ Done | Docker image + compose + `docker:run` with `-it` and quiet rebuild |
| ✅ Done | Env-based paths and clipboard for headless |
| ✅ Done | WebTorrent NAT/UTP hardening in containers |
| ✅ Done | CI on three OS + Docker build + launcher smoke tests |
| ✅ Done | Release workflow (`.github/workflows/release.yml`) |
| ✅ Done | Documentation (changelog, troubleshooting, upstream diff) |
| ✅ Done | Root launchers with native/Docker menu |
| ✅ Done | TorZlink branding and electric blue theme |
| ✅ Done | Docker truecolor for correct logo colors |
| ✅ Done | **v1.4.0** tagged and released |
| 📋 Planned | Manual TUI download smoke test in Docker |
| 📋 Planned | Headless or scripted magnet workflow |
| 📋 Planned | Track upstream `baairon/torlink` for merges |

### Cut a release

After merging to [TiiZss/TorZlink](https://github.com/TiiZss/TorZlink) `main`:

```sh
git tag v1.4.0
git push origin v1.4.0
```

The `release` workflow runs tests, publishes `ghcr.io/tiizss/torzlink:latest` and `ghcr.io/tiizss/torzlink:v1.4.0`, and opens a GitHub Release with notes from [CHANGELOG.md](CHANGELOG.md).

## Acknowledgments

**TorZlink** is a maintained fork of [**torlink**](https://github.com/baairon/torlink). The original terminal torrent finder — the Ink TUI, curated sources, search-and-download flow, and overall design — was created by [**bairon** (@baairon)](https://github.com/baairon).

Thank you to bairon for open-sourcing the project and for the foundation this fork builds on. If you use TorZlink, consider starring both [this repository](https://github.com/TiiZss/TorZlink) and the [upstream project](https://github.com/baairon/torlink).

## Privacy

Your files stay on your disk, and nothing routes through a central server; TorZlink only talks to the torrent network directly. Once a download finishes it keeps seeding by default, sharing it back so the next person can find it just as easily. The network only works because people pass things along, and even a few minutes makes a real difference. If you'd rather not, opt out anytime: open the Seeding tab, press `p` to pause or stop any item, and press it again to pick it back up. Always your call.