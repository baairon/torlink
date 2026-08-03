// Auto-stop seeding after a time limit (headless "seed mode"). Once a torrent
// has been finished for `seedTimeMs`, stop seeding it. By default the files are
// kept (it becomes a paused seed you can resume) — the point is to stop sharing,
// e.g. to stay ahead of DMCA notices, without losing your library. With
// `deleteFiles` it also removes the downloaded data to reclaim space.
//
// The clock is the download's completion time (history.completedAt), not when
// this process started, so a restart doesn't reset every torrent's timer.

import type { DownloadQueue } from "../download/queue";
import { deleteSeedData } from "../download/delete-data";

// Re-exported for backwards compatibility (the reaper's original home for it).
export { deleteSeedData } from "../download/delete-data";

const DEFAULT_CHECK_MS = 30_000;

// The slice of DownloadQueue the reaper needs — keeps it trivially testable.
export interface ReapableQueue {
  getSeeds(): { id: string; name: string; dir: string; status: string }[];
  getHistory(): { id: string; completedAt: number }[];
  stopSeeding(id: string): void;
}

export interface DueSeed {
  id: string;
  name: string;
  dir: string;
}

// The actively-seeding torrents whose completion is older than the limit.
export function dueSeeds(queue: ReapableQueue, seedTimeMs: number, now: number): DueSeed[] {
  const completedAt = new Map(queue.getHistory().map((h) => [h.id, h.completedAt]));
  const out: DueSeed[] = [];
  for (const s of queue.getSeeds()) {
    if (s.status !== "seeding") continue;
    const since = completedAt.get(s.id) ?? now; // unknown completion → treat as just finished
    if (now - since >= seedTimeMs) out.push({ id: s.id, name: s.name, dir: s.dir });
  }
  return out;
}

export interface SeedReaperOptions {
  deleteFiles?: boolean;
  log?: (message: string) => void;
  intervalMs?: number;
}

export function startSeedReaper(
  queue: DownloadQueue,
  seedTimeMs: number,
  options: SeedReaperOptions = {},
): () => void {
  const { deleteFiles = false, log = () => {}, intervalMs = DEFAULT_CHECK_MS } = options;
  const tick = (): void => {
    for (const s of dueSeeds(queue, seedTimeMs, Date.now())) {
      queue.stopSeeding(s.id);
      if (deleteFiles) {
        void deleteSeedData(s.dir, s.name).then((target) => {
          log(`seed time reached, stopped seeding + deleted files: ${target ?? s.name}`);
        });
      } else {
        log(`seed time reached, stopped seeding (files kept): ${s.name}`);
      }
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
