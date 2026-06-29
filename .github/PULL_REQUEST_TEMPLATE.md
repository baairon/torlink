## What and why

<!-- What does this change do, and why? The diff shows the what; tell us the why. -->

## Checklist

- [ ] `npm run typecheck` is clean
- [ ] `npm test` passes
- [ ] New logic has a test (vitest; mock node built-ins for platform code)
- [ ] If I added a key, I updated both `HELP_GROUPS` and `footerHints` in `src/ui/keymap.ts`
- [ ] If I added a `Store` field, I updated `makeStore` in `scripts/render-previews-impl.tsx`
- [ ] OS-touching code works on Windows, macOS, and Linux
- [ ] One concern, with a Conventional Commits title (`feat:` / `fix:` / `docs:` / `chore:`)

New here? [CONTRIBUTING.md](../CONTRIBUTING.md) explains each of these with examples from real merged PRs.
