import os from "node:os";
import path from "node:path";

// node:path doesn't export its interface by name, so borrow it off a member.
type PlatformPath = typeof path.win32;

// We read the raw input field, so expand a leading ~ ourselves (~\ too, for
// paths pasted from Windows). ~bob isn't us, so leave it alone.
// `p` lets a caller reasoning about one platform's paths (and its tests) pass
// path.win32 / path.posix instead of the host's flavour; it defaults to the host.
export function expandHome(
  input: string,
  home: string = os.homedir(),
  p: PlatformPath = path,
): string {
  const trimmed = input.trim();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return p.join(home, trimmed.slice(2));
  }
  return trimmed;
}

// Typed input -> a path for fs.mkdir. Blank returns "" (caller: leave it be).
export function normalizeDownloadDir(input: string, home: string = os.homedir()): string {
  const expanded = expandHome(input, home);
  if (!expanded) return "";
  return path.normalize(expanded);
}
