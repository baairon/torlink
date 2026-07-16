# Next session — TorZlink backlog

In progress after **v1.7.1**: web UI parity (download-to…, upload `.torrent`); NAS redeploy for the VPN auto-switch stack.

## Product invariant — Web ≡ TUI

**La web (`torzlink serve`) debe ser un clon funcional de la TUI.** Mismo alcance de producto, mismos flujos; solo cambia el shell (HTML vs Ink). No se considera “done” una feature de TUI hasta que exista equivalente usable en la web (API + UI).

### Paridad TUI → Web (checklist)

| # | Capacidad TUI | Estado web | Notas de implementación |
| --- | --- | --- | --- |
| 1 | Búsqueda multi-fuente + resultados | OK | Filtro categoría/group + hideDead + sort en `GET /api/search` |
| 2 | Añadir a cola (magnet / infohash / resultado) | Parcial | OK básico; falta “download to…” (carpeta alternativa por ítem) |
| 3 | Cola activa: pause / resume / cancel + progreso | Parcial | OK + ETA en UI; falta open folder (evitar en web remota) |
| 4 | **Downloads** (historial / recently downloaded) | OK | `GET/DELETE /api/history` + redownload; pestaña History |
| 5 | **Seeding** (lista, pause/stop seed) | OK | `GET /api/seeds` + pause/resume/toggle; pestaña Seeding |
| 6 | Copiar magnet / guardar `.magnet` | OK | `POST /api/copy-magnet` + botón Copiar (clipboard + Telegram) |
| 7 | Pegar magnet (clipboard / input) | Parcial | Input magnet OK; clipboard del host es distinto en browser |
| 8 | Abrir `.torrent` | Falta | Upload / path API |
| 9 | Config: carpeta de descarga global | OK | `GET/PATCH /api/config` + panel Config; bloqueada si `TORZLINK_DOWNLOAD_DIR` |
| 10 | Config: trackers custom (+ warning hosts) | OK | Misma validación TUI (`parseTrackers` / `unknownTrackerHosts`) |
| 11 | Categorías / filtros de fuentes (sidebar) | OK | Tabs All/Games/Movies/TV/Anime (`src/sources/categories.ts`) |
| 12 | Ordenación de resultados | OK | `sort=` en search (seeders/size/name/source) |
| 13 | Help / keymap contextual | N/A web | Sustituir por ayuda corta en UI (no clonar atajos Ink) |
| 14 | Splash / branding | Parcial | Look retro alineado; splash TUI no obligatorio |
| 15 | Notificaciones Telegram (copy/start/complete/error) | Parcial | Copy vía API; start/complete/error vía runtime serve |
| 16 | Modo red **direct** ↔ **vpn** (NAS) | OK (código) | Toggle + `SWITCH_CMD` + socket; falta smoke en NAS tras redeploy |

**Regla de trabajo:** cada PR de producto web debe avanzar al menos una fila “Falta” → “Parcial/OK” y compartir lógica con el core (no reimplementar scrapers/queue en el front).

## Ops invariant — VPN ON/OFF sin redeploy

**Estado: implementado en código** (pendiente validar en NAS con `deploy-from-dev`).

- Compose NAS monta Docker socket + `tools/torzlink-network-switch.sh` vía `TORZLINK_NETWORK_SWITCH_CMD`
- `POST /api/network` persiste preferencia, parchea `.env`, arranca el switch en **detached** y la UI hace polling hasta `runtime === desired`
- Requiere `DOCKER_GID` correcto + `TORZLINK_SERVE_TOKEN` (ver ADR-001)
- Phase 2 (opcional): sidecar sin socket en el proceso BitTorrent, o routing Gluetun sin cambiar `network_mode`

## Recommended order

| Priority | Area | Item | Notes |
| --- | --- | --- | --- |
| 1 | Ops | Traefik labels on Gluetun (vpn UI) | Switch aplica `network_mode:container:gluetun`; sin labels en Gluetun, `torzlink.lan` no responde en VPN |
| 2 | Product | Web remaining parity | download-to…, upload `.torrent` (config downloadDir/trackers OK) |
| 3 | QA | Manual TUI download smoke test in Docker (Windows host) | Validate end-to-end on the primary dev machine |
| 4 | Docs | Windows-specific Docker volume docs | `%cd%`, WSL2, Desktop bind-mount quirks |
| 5 | Quality P2 | Zod schema for `config.json` | `downloadDir`, `trackers[]` validation at load |
| 6 | Quality P2 | Scraper anti-corruption layer | Rebuild magnet from infoHash; no raw HTML passthrough |

## Also on the board

- **P2:** `TORZLINK_DOWNLOAD_ROOT` path jail, structured logging `TORZLINK_LOG`, no-seed-by-default
- **Web UX:** SSE/WebSocket progress (sustituto del refresh 1s), Traefik basicAuth opcional
- **Maintenance:** Selective upstream sync from `baairon/torlink`
- **Launchers:** [docs/follow-ups-launchers.md](follow-ups-launchers.md) — modo **web** hecho; queda code review PR hygiene

## Reference — v1.7.1

- NAS bind: `TORZLINK_DOWNLOADS_HOST` → `/downloads`; container `user: PUID:PGID`
- `deploy-from-dev.ps1` plink+cat for remote `.env`; bash `if/fi` for Gluetun check
- POST `/api/downloads` → **409** when already queued

## Skills to invoke

See [docs/agent-workflow.md](agent-workflow.md) for the full routing table, review gates, and release checklist.
