# ADR-001: Trust model for TorZlink

**Status:** Accepted (amended 2026-07-16)  
**Date:** 2026-07-11  
**Context:** TorZlink is a local-first torrent finder. It scrapes curated indexers, downloads via WebTorrent, optionally notifies Telegram, and can run as a TUI or as a LAN web UI (`torzlink serve`) behind a reverse proxy. Security work needs a shared mental model for what we trust and what we do not.

## Decision

### Trust boundaries

| Boundary | Trusted side | Untrusted side | Controls |
| --- | --- | --- | --- |
| User → TorZlink (TUI) | Local operator on a TTY | N/A | Interactive terminal only for Ink mode |
| User → TorZlink (HTTP) | Operator on trusted LAN via Traefik `*.lan` (or equivalent) | WAN / unauthenticated internet; other containers on `proxy_net` | Optional `TORZLINK_SERVE_TOKEN` (Bearer on `/api/*`); bind to Docker network only; **do not** publish WAN routers without Traefik auth; treat API as full admin of the queue |
| Indexers → TorZlink | Curated source list only | HTML/RSS/magnet strings | `safeDisplayText`, `sanitizeDownloadInput`, FitGirl-only for games |
| TorZlink → WebTorrent | Sanitized magnets + optional user trackers | Swarm peers, tracker operators | Rebuild magnet from infoHash; warn on unknown tracker hosts |
| TorZlink → filesystem | User-chosen download/state dirs | Scraped filenames | `sanitizeFilename`, path normalization |
| TorZlink → Telegram (optional) | User-owned bot + channel | Telegram API, channel members | `.magnet` attachments on copy/start; no magnet URI on complete/error; secrets in `.env` only |
| TorZlink → network | User intent (search/download/seed) | ISP, trackers, peers | Documented seeding exposure; optional NAS **vpn** mode via Gluetun (`TORZLINK_NETWORK_MODE=vpn`) |

### HTTP / NAS deployment modes

- **`direct`:** container on Traefik `proxy_net`; swarm uses the NAS public IP.
- **`vpn`:** `network_mode: container:gluetun`; swarm exits via VPN; Traefik labels live on the Gluetun container (same pattern as qBittorrent).

Both modes assume LAN-only DNS (`torzlink.lan` → Traefik). Opening the UI on the public internet without Traefik auth (basicAuth / Authelia / etc.) is an accepted risk only if the operator explicitly chooses it — not the default.

Set `TORZLINK_SERVE_TOKEN` when other containers share `proxy_net`: Traefik middleware alone does not stop east-west calls to `:8787`.

### Source policy

- **Games:** FitGirl repacks only — only category that routinely ships executables/installers.
- **Video / subtitles:** YTS, TPB, 1337x, EZTV, Nyaa, SubsPlease — treated as media, still untrusted bytes until verified by the user.
- **Scraped magnets:** Never passed verbatim to WebTorrent when a canonical rebuild from `infoHash` is possible.

### Privacy defaults

- **Seeding:** On by default after download (upstream behaviour). User can pause/stop in Seeding tab / later web UI. Documented in README Privacy section.
- **Telegram:** Opt-in via `.env`. Completion notifications omit magnet URIs; copy/start use `.magnet` file attachments.
- **Custom trackers:** Saved in local `config.json`. Unknown hosts trigger an in-app warning; they receive announce traffic for future adds.

### Supply chain

- `package-lock.json` + `npm ci` for reproducible installs.
- CI: Gitleaks, `npm audit` (critical gate), Trivy (critical gate).
- Known transitive HIGH in `webtorrent`/`ip` tracked; no semver-major downgrade without explicit ADR.

## Consequences

- New features (headless CLI, web UI, VPN compose profiles) are reasoned against this table.
- Security tests assert invariants: no raw scraped magnet at download boundary, no control chars in display labels, unknown trackers warned.
- Does **not** remove torrent malware risk or IP exposure from seeding in `direct` mode — users remain responsible for content and network privacy.
- The HTTP admin API is equivalent to physical access to the TUI: protect the LAN edge accordingly.

## References

- [README.md](../README.md) — Privacy, Telegram, NAS / Traefik deploy
- [CHANGELOG.md](../CHANGELOG.md) — Security entries
- OWASP-adjacent: treat all external indexer output as hostile input at the parser boundary
