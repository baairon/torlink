// Auto-stop seeding after a time limit (headless "seed mode"). Once a torrent
// has been finished for `seedTimeMs`, stop seeding it. By default the files are
// kept (it becomes a paused seed you can resume) — the point is to stop sharing,
// e.g. to stay ahead of DMCA notices, without losing your library. With
// `deleteFiles` it also removes the downloaded data to reclaim space.
//
// The clock is the download's completion time (history.completedAt), not when
// this process started, so a restart doesn't reset every torrent's timer.
//
// A torrent can carry its own limit (history.seedTimeMs, set over the headless
// API): that wins over the daemon-wide value, and 0 there means "never stop
// this one". With neither set the seed is left alone, so the reaper is safe to
// run even when the daemon has no --seed-time.

import type { DownloadQueue } from "../download/queue";
import { deleteSeedData } from "../download/delete-data";

// Re-exported for backwards compatibility (the reaper's original home for it).
export { deleteSeedData } from "../download/delete-data";

const DEFAULT_CHECK_MS = 30_000;

// The slice of DownloadQueue the reaper needs — keeps it trivially testable.
export interface ReapableQueue {
  getSeeds(): { id: string; name: string; dir: string; status: string }[];
  getHistory(): { id: string; completedAt: number; seedTimeMs?: number }[];
  stopSeeding(id: string): void;
}

export interface DueSeed {
  id: string;
  name: string;
  dir: string;
}

// The effective limit for one torrent: its own if it has one, else the
// daemon-wide value. 0 / undefined means no limit.
export function seedLimitFor(own: number | undefined, daemonWide: number): number {
  return own ?? daemonWide;
}

// The actively-seeding torrents whose completion is older than their limit.
// `seedTimeMs` is the daemon-wide default (0 = none); a torrent's own
// history.seedTimeMs overrides it.
export function dueSeeds(queue: ReapableQueue, seedTimeMs: number, now: number): DueSeed[] {
  const history = new Map(queue.getHistory().map((h) => [h.id, h]));
  const out: DueSeed[] = [];
  for (const s of queue.getSeeds()) {
    if (s.status !== "seeding") continue;
    const h = history.get(s.id);
    const limit = seedLimitFor(h?.seedTimeMs, seedTimeMs);
    if (!(limit > 0)) continue;
    const since = h?.completedAt ?? now; // unknown completion → treat as just finished
    if (now - since >= limit) out.push({ id: s.id, name: s.name, dir: s.dir });
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
