// Best-effort delete of a torrent's on-disk data: only the torrent's own entry
// directly under its download dir (a file, or the folder named after it). Never
// walks outside that dir, never throws. Shared by the seed reaper (auto-purge
// after the seed timer) and the headless control API (manual delete).

import { rm } from "node:fs/promises";
import path from "node:path";
import { getCompletedDir, getSeedingDir, getDownloadsDir } from "../config/folder";

export async function deleteSeedData(dir: string, name: string): Promise<string | null> {
  const base = path.basename(name.trim());
  if (!base || base === "." || base === "..") return null;

  const targets = [
    path.join(getCompletedDir(dir), base),
    path.join(getSeedingDir(dir), base),
    path.join(getDownloadsDir(dir), base),
    path.join(dir, base),
  ];

  for (const target of targets) {
    await rm(target, { recursive: true, force: true }).catch(() => {});
  }

  return path.join(getCompletedDir(dir), base);
}

