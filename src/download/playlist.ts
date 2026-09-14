import { promises as fs } from "node:fs";
import path from "node:path";
import { logCrash } from "../util/crashlog";

const MEDIA_EXTENSIONS = new Set([
  ".aac", ".aiff", ".avi", ".flac", ".flv", ".m2ts", ".m4a", ".m4v",
  ".mka", ".mkv", ".mov", ".mp3", ".mp4", ".mpeg", ".mpg", ".oga",
  ".ogg", ".ogv", ".opus", ".wav", ".webm", ".wma", ".wmv",
]);
const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

// WebTorrent's file paths include the torrent's top-level directory. Group
// media under each ancestor, stopping before the shared downloads directory.
// A course gets a whole-course playlist and one per module with 2+ lessons.
export function buildPlaylists(filePaths: string[]): Map<string, string> {
  const groups = new Map<string, string[]>();
  const files = new Set(filePaths.map((file) => file.split(path.sep).join("/")));
  for (const file of files) {
    const parts = file.split("/");
    // Reject unsafe/ambiguous paths on every platform, including Windows
    // drive/UNC paths and newlines that could inject extra playlist entries.
    if (
      /[\\\x00-\x1f]/.test(file) || /^[a-z]:/i.test(file) ||
      parts.some((p) => !p || p === "." || p === "..")
    ) continue;
    if (!MEDIA_EXTENSIONS.has(path.posix.extname(file).toLowerCase())) continue;
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      const entries = groups.get(dir) ?? [];
      entries.push(parts.slice(i).join("/"));
      groups.set(dir, entries);
    }
  }

  const playlists = new Map<string, string>();
  const occupied = new Set([...files].map((file) => file.toLowerCase()));
  for (const [dir, entries] of groups) {
    const target = `${dir}/playlist.m3u`;
    // Never replace a file supplied by the torrent, even if it is absent on
    // disk. Also leave single-file folders alone: opening the file is enough.
    if (entries.length < 2 || occupied.has(target.toLowerCase())) continue;
    entries.sort((a, b) => natural.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
    const uris = entries.map((entry) => `./${entry.split("/").map(encodeURIComponent).join("/")}`);
    playlists.set(target, `#EXTM3U\n${uris.join("\n")}\n`);
  }
  return playlists;
}

// Only create new files in existing torrent directories. Exclusive creation
// preserves user playlists (and symlinks); no mkdir means a removed torrent
// cannot be recreated by this background completion task.
export async function writePlaylists(downloadDir: string, filePaths: string[]): Promise<void> {
  try {
    const playlists = buildPlaylists(filePaths);
    if (playlists.size === 0) return;
    const root = await fs.realpath(downloadDir);
    for (const [relative, content] of playlists) {
      try {
        const target = path.join(root, relative);
        const parent = await fs.realpath(path.dirname(target));
        const inside = path.relative(root, parent);
        if (
          !inside || inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)
        ) continue;
        await fs.writeFile(path.join(parent, "playlist.m3u"), content, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") logCrash("playlist", error);
      }
    }
  } catch (error) {
    // An optional playlist must never turn a verified download into a failure.
    logCrash("playlist", error);
  }
}
