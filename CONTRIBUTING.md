# Contributing to TorZlink

TorZlink stays small on purpose. The best way in is to read the code you're about to touch, match how it already works, and keep your change tight. Three recent pull requests set the bar, and this guide points back at them throughout:

- [#4](https://github.com/baairon/torlink/pull/4) gave the arrow keys spatial pane navigation without breaking a single existing shortcut.
- [#5](https://github.com/baairon/torlink/pull/5) turned a cryptic crash on old Node into a one-line "upgrade me" message.
- [#6](https://github.com/baairon/torlink/pull/6) added copy-magnet, cross-platform, with tests.

## Repository layout

```
src/app/          entry point (Ink TUI)
src/config/       paths, config, .env loading
src/download/     queue, engine, persistence
src/integrations/ Telegram + notify hub
src/sources/      search adapters
src/ui/           components, state, views
assets/preview/   README screenshots (SVG)
packaging/docker/ Dockerfile + compose
packaging/nix/    Nix package
tools/            dev utilities (previews, seeding check)
docs/             follow-up notes (e.g. launcher backlog)
tests/            Vitest (mirrors src/)
```

Save source files and `.env` as **UTF-8** (no BOM on Windows). `.editorconfig` and `.gitattributes` enforce this in the repo.

Local AI agent rules (`.agents/`, `.cursor/rules/`, etc.) are **not** versioned — keep your own copy per machine.

## Before you open a PR

```sh
./torzlink.sh           # menu: native or Docker (torzlink.cmd on Windows)
npm run launch          # or npm run dev after first install
npm test
npm run build
```

In CI or when you want to skip dependency self-update:

```sh
TORZLINK_SKIP_UPDATE=1 npm run dev
```

## Launcher scripts (`torzlink.sh`, `torzlink.ps1`, `torzlink.cmd`)

Keep **bash and PowerShell behavior in sync** (menu, errors, Docker, `.env`). Pending improvements and agent skills to use: [docs/follow-ups-launchers.md](docs/follow-ups-launchers.md).

## Cross-platform

TorZlink runs on Windows, macOS, and Linux, so anything that touches the OS branches all three. Look at `writeClipboard` in `src/util/clipboard.ts` from #6: `clip.exe` / PowerShell on win32, pbcopy on darwin, then wl-copy, xclip, xsel on linux. #5's `scripts/cli-entry.cjs` is the same instinct aimed at the Node runtime. "Works on my machine" is not the bar.

## UI conventions

TorZlink shows one contextual footer plus a `?` cheatsheet, never a wall of commands. Two rules when you add to it:

1. Only show keys that work in the current pane and mode.
2. If a key does two things depending on context, the footer shows the one that applies now.

## Visual style

TorZlink is electric blue and quiet. There is exactly one gradient, the wordmark sheen. Everything else is solid color. Please don't add a second gradient.

Thanks for helping keep TorZlink sharp.

Upstream credit: see [Acknowledgments](README.md#acknowledgments) in the README — TorZlink is a fork of [baairon/torlink](https://github.com/baairon/torlink) by [bairon](https://github.com/baairon).
