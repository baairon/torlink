import { loadConfig, type Config } from "../config/config";
import { DownloadQueue } from "../download/queue";
import { loadHistory } from "../download/history";
import { loadQueue, loadSeeds } from "../download/persist";
import { reconcileQueue } from "../download/reconcile";

export interface TorzlinkRuntime {
  config: Config;
  queue: DownloadQueue;
  dispose: () => void;
}

/** Shared boot for TUI and `torzlink serve` — one DownloadQueue per process. */
export async function createTorzlinkRuntime(): Promise<TorzlinkRuntime> {
  const config = await loadConfig();
  const queue = new DownloadQueue();
  queue.setTrackers(config.trackers);
  queue.restore(reconcileQueue(await loadQueue()));
  queue.restoreHistory(await loadHistory());
  queue.restoreSeeds(await loadSeeds());
  return {
    config,
    queue,
    dispose: () => {
      queue.suspend();
    },
  };
}
