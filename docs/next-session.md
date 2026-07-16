# Next session — TorZlink backlog

In progress after **v1.7.1**: web UI parity (categories, copy magnet, history, seeding); NAS redeploy + VPN apply-without-redeploy still pending.

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
| 16 | Modo red **direct** ↔ **vpn** (NAS) | Parcial | Toggle UI VPN ON/OFF existe; **falta apply sin redeploy** (ver invariante abajo) |

**Regla de trabajo:** cada PR de producto web debe avanzar al menos una fila “Falta” → “Parcial/OK” y compartir lógica con el core (no reimplementar scrapers/queue en el front).

## Ops invariant — VPN ON/OFF sin redeploy

**El switch VPN de la web debe aplicar el cambio de salida (direct ↔ Gluetun) sin `deploy-from-dev` / rebuild de imagen ni un redeploy manual del operador.**

Hoy el compose usa perfiles/`network_mode: container:gluetun`, que obliga a recrear el contenedor. Objetivo de producto:

- Clic en **VPN ON/OFF** → el swarm sale (o deja de salir) por VPN de forma efectiva
- Sin pedir al usuario que vuelva a desplegar desde el PC
- Aceptable: recrear/reenganchar el contenedor TorZlink vía API/agente en el NAS (p. ej. `deploy-nas.sh switch` o Docker socket / sidecar privilegiado), **siempre que sea automático tras el clic**
- No aceptable como estado final: solo guardar preferencia en `.env` / `network-mode.json` y dejar el runtime igual hasta un redeploy humano

Ideas de diseño (elegir una en implementación):

1. Sidecar/host helper con Docker socket que ejecuta `compose --profile … up -d` al recibir el POST `/api/network`
2. Contenedor siempre en `proxy_net` + routing/policy vía Gluetun (sin cambiar `network_mode`) si el homelab lo permite
3. `TORZLINK_NETWORK_SWITCH_CMD` cableado por defecto en el compose NAS al script de switch del host

## Recommended order

| Priority | Area | Item | Notes |
| --- | --- | --- | --- |
| 1 | Ops | **VPN ON/OFF sin redeploy** | Switch web aplica direct↔vpn automáticamente; ver invariante arriba |
| 2 | Ops | NAS redeploy (UI retro + switch VPN + parity incremental) | `deploy-from-dev` cuando el look/dev esté OK |
| 3 | Product | Web remaining parity | download-to…, upload `.torrent` (config downloadDir/trackers OK) |
| 4 | QA | Manual TUI download smoke test in Docker (Windows host) | Validate end-to-end on the primary dev machine |
| 5 | Docs | Windows-specific Docker volume docs | `%cd%`, WSL2, Desktop bind-mount quirks |
| 6 | Quality P2 | Zod schema for `config.json` | `downloadDir`, `trackers[]` validation at load |
| 7 | Quality P2 | Scraper anti-corruption layer | Rebuild magnet from infoHash; no raw HTML passthrough |

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
