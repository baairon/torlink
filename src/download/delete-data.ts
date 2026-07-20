// Best-effort delete of a torrent's on-disk data: only the torrent's own entry
// directly under its download dir (a file, or the folder named after it). Never
// walks outside that dir, never throws. Shared by the seed reaper (auto-purge
// after the seed timer) and the headless control API (manual delete).

import { rm } from "node:fs/promises";
import path from "node:path";

export interface DeleteResult {
  target: string;
  /** false means the rm failed (the files are still there) — callers must not
   * report a deletion that didn't happen. */
  deleted: boolean;
}

export async function deleteSeedData(dir: string, name: string): Promise<DeleteResult | null> {
  const base = path.basename(name.trim());
  if (!base || base === "." || base === "..") return null;
  const target = path.join(dir, base);
  // Right after a torrent stops, webtorrent's chunk store can still hold the
  // files open; on Windows that fails the first rm with EPERM/EBUSY, so retry
  // once after a beat before admitting failure.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await rm(target, { recursive: true, force: true });
      return { target, deleted: true };
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
    }
  }
  return { target, deleted: false };
}
