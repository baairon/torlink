// A file dragged onto a terminal window never arrives as a clean path: every
// emulator escapes it its own way. Windows Terminal and PowerShell wrap it in
// double quotes (and leave a trailing space), macOS Terminal and iTerm2 escape
// spaces and parens with backslashes, GNOME Terminal pastes a file:// URI.
// Normalize all of those back to a plain path before we touch the disk.

import os from "node:os";
import path from "node:path";
import { expandHome } from "../config/folder";

export interface TorrentPathOptions {
  home?: string;
  // Platform of the *path*, not of the process: a Windows path keeps its
  // backslashes, a POSIX one has them stripped as escapes. Defaults to the
  // host, and is passed explicitly by the tests so all three shapes are
  // checked on every OS rather than only on the one that produces them.
  windows?: boolean;
}

// Strips one matching pair of surrounding quotes. Callers get a trimmed string
// either way, so a dropped path's trailing space is gone before anything else.
export function unquote(input: string): string {
  const s = input.trim();
  const first = s[0];
  if (s.length >= 2 && (first === '"' || first === "'") && s[s.length - 1] === first) {
    return s.slice(1, -1).trim();
  }
  return s;
}

// file:///home/u/a.torrent -> /home/u/a.torrent, file:///C:/u/a.torrent -> C:/u/a.torrent.
// Decoded by hand rather than via fileURLToPath so the result depends on the
// path's platform, not the running one. Returns null for anything not a file URI.
export function fromFileUrl(input: string, windows: boolean): string | null {
  const m = /^file:\/\/(?:localhost)?(\/.*)$/i.exec(input);
  if (!m) return null;
  let p: string;
  try {
    p = decodeURIComponent(m[1]!);
  } catch {
    return null; // a stray % that isn't an escape
  }
  // A Windows URI carries a leading slash before the drive letter: /C:/x -> C:/x.
  if (windows && /^\/[a-z]:/i.test(p)) p = p.slice(1);
  return p;
}

// Raw input field text -> a path to read, or null if this isn't a .torrent path
// at all (an ordinary search query, a magnet link). Existence isn't checked
// here; the caller reads the file and reports its own failure.
export function resolveTorrentPath(raw: string, options: TorrentPathOptions = {}): string | null {
  const windows = options.windows ?? process.platform === "win32";
  const home = options.home ?? os.homedir();
  const unquoted = unquote(raw);
  if (!unquoted) return null;

  const p = windows ? path.win32 : path.posix;
  const url = fromFileUrl(unquoted, windows);
  // Backslash is a path separator on Windows, so only POSIX unescapes: there
  // `My\ Files` means one folder named "My Files".
  const bare = url ?? (windows ? unquoted : unquoted.replace(/\\(.)/g, "$1"));
  if (!/\.torrent$/i.test(bare)) return null;
  // A URI is already absolute; only typed input can carry a ~.
  const expanded = url ?? expandHome(bare, home, p);
  return p.normalize(expanded);
}
