# Next session — TorZlink backlog

Session closed **2026-07-16** with **v1.7.0** (web UI + NAS/Traefik; tag pending push).

## Recommended order

| Priority | Area | Item | Notes |
| --- | --- | --- | --- |
| 1 | QA | Manual TUI download smoke test in Docker (Windows host) | Validate end-to-end on the primary dev machine |
| 2 | Docs | Windows-specific Docker volume docs | `%cd%`, WSL2, Desktop bind-mount quirks |
| 3 | Ops | NAS smoke on Ugreen | `deploy-nas.sh up`; toggle `direct`/`vpn`; open `http://torzlink.lan` |
| 4 | Quality P2 | Zod schema for `config.json` | `downloadDir`, `trackers[]` validation at load |
| 5 | Quality P2 | Scraper anti-corruption layer | Rebuild magnet from infoHash; no raw HTML passthrough |

## Also on the board

- **P2:** `TORZLINK_DOWNLOAD_ROOT` path jail, structured logging `TORZLINK_LOG`, no-seed-by-default
- **Web UI follow-ups:** history/seeds tabs, SSE progress, optional Traefik basicAuth
- **Maintenance:** Selective upstream sync from `baairon/torlink`
- **Launchers:** [docs/follow-ups-launchers.md](follow-ups-launchers.md) — code review PR hygiene

## Reference — v1.7.0

- `torzlink serve` — HTTP API + static web UI (search + queue); optional `TORZLINK_SERVE_TOKEN`
- ADR-001 amended for LAN HTTP + Gluetun `direct`/`vpn` modes
- `packaging/docker/docker-compose.nas.yml` + `tools/deploy-nas.sh` + `.env.nas.example`

## Skills to invoke

See [docs/agent-workflow.md](agent-workflow.md) for the full routing table, review gates, and release checklist.
