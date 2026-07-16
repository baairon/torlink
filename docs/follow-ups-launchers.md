# Follow-ups — launcher scripts (`torzlink.sh` / `torzlink.ps1` / `torzlink.cmd`)

Backlog from the launcher implementation session. Pick items when they become necessary — not all at once.

## When to use which agent skill

| Situation | Skill / tool |
|-----------|----------------|
| Touch Docker, compose, CI for launchers | `engineering-devops-automator` |
| Review launcher changes before merge | `engineering-code-reviewer` or `review-bugbot` |
| Split launcher work from other changes | `split-to-prs` or `engineering-git-workflow-master` |
| Error messages, smoke checklist, operability | `engineering-sre` |
| `.env` / secrets handling review | `security-senior-secops` |

## Contract bash ↔ PowerShell (keep in sync)

Both scripts must behave the same for:

| Behavior | Expected |
|----------|----------|
| Invalid menu input | Re-prompt (do not exit) |
| Fatal error | Clear message + `exit 1` (no PowerShell stack trace) |
| Docker path | `docker compose -f packaging/docker/docker-compose.yml build --quiet torzlink` then `run --rm -it torzlink` — **no npm** |
| Missing `.env` | Explain (Telegram optional); prompt to create empty file; then continue |
| Bypass flags | `--native` / `--docker` / `--web` (and ps1 `-Native` / `-Docker` / `-Web`) skip menu |
| No TTY | Require explicit bypass flags |
| Menu modes | **native** (TUI), **docker** (TUI in container), **web** (`torzlink serve` — UI HTTP) |

When editing one launcher file, check the other and update this table if behavior changes.

## Checklist — next session

### Product — include web UI in launcher

- [x] Add **web** as a third menu option in `torzlink.sh`, `torzlink.ps1`, and `torzlink.cmd` (alongside native / Docker)
- [x] Native web path: `npm run serve` → `tsx src/app/entry.tsx serve` (same ensure flow as launch)
- [x] Bypass flag: `--web` / `-Web` / menu key `3` (keep `1` native, `2` docker)
- [x] Keep bash ↔ PowerShell ↔ `.cmd` in sync; update smoke tests for the new mode
- [x] Document the new option in README (launcher section)

### Tests & CI (do when launchers change again)

- [x] Add smoke script under `tools/` (e.g. `tools/test-launchers.sh`) that verifies:
  - `--native` / `--docker` bypass parsing (dry-run or mock; no full TUI)
  - Invalid menu → re-prompt (bash + PowerShell)
  - Missing `.env` → friendly path (temp dir, no real Docker run)
  - Docker path does **not** invoke `npm`
- [x] Optional: GitHub Actions job — `bash` on ubuntu, `pwsh` on windows — run smoke only

### Code quality (do before next PR that touches launchers)

- [ ] Run **Code Reviewer** / Bugbot on `torzlink.ps1`, `torzlink.sh`, `torzlink.cmd`
- [x] Add header comment in each script: `Keep in sync with <other file> — see docs/follow-ups-launchers.md`

### Git / PR hygiene (do when committing launcher work)

- [ ] Separate PR: launchers + docs only (exclude unrelated `.agents/` unless intentionally versioned)
- [ ] Conventional commit, e.g. `feat(launch): add root menu scripts for native and Docker`

### DevOps (do if Docker onboarding still confuses users)

- [ ] Read **DevOps Automator** skill before changing compose / env flow
- [ ] Consider making `env_file` optional in compose **or** document that empty `.env` is created by launcher (current behavior)
- [ ] Windows: document Docker Desktop PATH / WSL2 notes in README if users report `docker not found`

### SRE / UX (do if error reports continue)

- [ ] Standardize fatal messages: what failed, what to install, link to README section
- [ ] Post-change smoke: `.\torzlink.ps1` → invalid key → `2` → `Y` for `.env` → Docker starts

### Security (low priority unless copying `.env.example`)

- [x] `.env.example` — Telegram vars commented by default; README warns not to use placeholders
- [x] Launcher warns when `.env` contains placeholder Telegram token/channel values

## Already done (session reference)

### v1.6.0 — security hardening (2026-07-11)

- P0/P1 security: CI gates, lockfile, magnet sanitization, TUI `safeDisplayText`, launcher `.env` warnings
- P1: tracker host warnings, ADR-001, regression tests, CycloneDX SBOM on release
- Release pipeline: `package-lock.json` in Docker context; SBOM stdout redirect
- Published: [v1.6.0](https://github.com/TiiZss/TorZlink/releases/tag/v1.6.0)

### Launchers (earlier sessions)

- Root launchers with interactive menu
- `Stop-Launcher` / clean errors in PowerShell (no `throw` stack traces for users)
- Bash menu loop aligned with PowerShell
- `Initialize-DockerEnvFile` before compose
- Docker calls `docker compose` directly (`build --quiet` + `run`)
- `debug-*.log` in `.gitignore`; debug telemetry removed from scripts

## Out of scope (unless explicitly requested)

- Installer `.msi` / `.dmg`
- Menu options beyond native / Docker / **web** (build, test, etc.)
- Dockerized web serve as a separate launcher mode (unless product asks for it; default web path is native `serve`)
