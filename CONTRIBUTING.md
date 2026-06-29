# Contributing to torlink

torlink stays small on purpose. The best way in is to read the code you're about to touch, match how it already works, and keep your change tight. Three recent pull requests set the bar, and this guide points back at them throughout:

- [#4](https://github.com/baairon/torlink/pull/4) gave the arrow keys spatial pane navigation without breaking a single existing shortcut.
- [#5](https://github.com/baairon/torlink/pull/5) turned a cryptic crash on old Node into a one-line "upgrade me" message.
- [#6](https://github.com/baairon/torlink/pull/6) added copy-magnet, cross-platform, with tests.

None of them were big. All of them fit the grain. That's the whole idea.

## Set up

```sh
git clone https://github.com/baairon/torlink
cd torlink
npm install
npm run dev
```

`npm run dev` runs the live TUI through tsx, no build step. The README's [Contributing](README.md#contributing) section has the build variant if you want it.

## Before you open a PR

Run these and make sure they're clean:

```sh
npm run typecheck   # tsc --noEmit, zero errors
npm test            # vitest, all green
```

Then check your change against the standards below. The pull request template walks you through the same list.

## The standards

### Match the existing grain

Reuse what's there before you write something new. Cursor movement goes through `wrapStep` (`src/ui/move.ts`). Key hints live in the `Hint` / `HELP_GROUPS` / `footerHints` system (`src/ui/keymap.ts`). Shared app state is the `Store` interface (`src/ui/store.ts`).

#4 is the model here: it added a whole navigation mode and still introduced no new state, it leaned on the existing `region` and `captureMode` flags and reused `wrapStep`. If you catch yourself adding a parallel way to do something the codebase already does, stop and use the one that's already there.

### Stay additive, never break muscle memory

People already have the current keys in their fingers. New behavior should layer on, not overwrite. #4 lit up the arrow keys (which did nothing before) while leaving tab, enter, esc, and every letter command exactly where they were. If your change retrains an existing key, it needs a real reason and a clear note in the PR.

### Cross-platform or it doesn't ship

torlink runs on Windows, macOS, and Linux, so anything that touches the OS branches all three. Look at `writeClipboard` in `src/util/clipboard.ts` from #6: powershell on win32, pbcopy on darwin, then wl-copy, xclip, xsel on linux. #5's `scripts/cli-entry.cjs` is the same instinct aimed at the Node runtime. "Works on my machine" is not the bar.

### Fail soft, never crash

When something the user can't control goes wrong, degrade gracefully and say so. #5 prints a friendly upgrade message and exits cleanly instead of letting old Node spit out a parse error. #6's `writeClipboard` returns `false` and surfaces a notice when no clipboard tool exists, it never throws. Reach for a clear message and a fallback before you reach for an exception.

### Test the logic

Non-trivial logic gets a vitest test. Pure functions are easy, see `src/util/format.test.ts`. For code that shells out or leans on a platform, mock the node built-in, see `src/util/clipboard.test.ts` from #6 mocking `node:child_process`. Run the suite with `npm test`.

### Wire the UI surface, and keep it minimal

torlink shows one contextual footer plus a `?` cheatsheet, never a wall of commands. Two rules when you add to it:

- A new key means updating both halves of `src/ui/keymap.ts`: `HELP_GROUPS` (the `?` sheet) and `footerHints` (the footer). #6 did both for `y`.
- A new `Store` field means adding a matching entry to `makeStore` in `scripts/render-previews-impl.tsx`, or `npm run previews` (the README screenshots) breaks. #6's `copyMagnet` sits in there as a noop for exactly this reason.

### Respect the calm theme

torlink is pastel-violet and quiet. There is exactly one gradient, the wordmark sheen. Everything else is solid color. Please don't add a second gradient.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org) prefixes: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`.
- Say why, not just what. The diff already shows the what.
- One concern per pull request. Two unrelated ideas are two PRs.

Thanks for helping keep torlink sharp.
