import { createContext, useContext, useEffect, useState } from "react";
import type { Config } from "../../config/config";
import type { DownloadQueue } from "../../download/queue";
import type { HistoryItem } from "../../download/history";
import type { QueueItem, SeedItem } from "../../download/types";
import type { SourceId } from "../../sources/types";
import type { Category } from "../../sources/categories";

export type View = "splash" | "browser";

export type { Category };
export { CATEGORIES } from "../../sources/categories";

export type Section = Category | "downloads" | "seeding";

export type Region = "sidebar" | "content" | "help";

export type CaptureMode = "none" | "text" | "esc";

export type DownloadFocus = "downloading" | "paused" | "failed" | "recent";

export type SeedFocus = "seeding" | "paused" | "missing" | "idle";

export interface Store {
  config: Config;
  setConfig: (c: Config) => void;
  queue: DownloadQueue;

  view: View;
  setView: (v: View) => void;
  query: string;
  submitQuery: (q: string) => void;

  section: Section;
  setSection: (s: Section) => void;
  region: Region;
  setRegion: (r: Region) => void;
  captureMode: CaptureMode;
  setCaptureMode: (m: CaptureMode) => void;

  downloadFocus: DownloadFocus | null;
  setDownloadFocus: (f: DownloadFocus | null) => void;
  seedFocus: SeedFocus | null;
  setSeedFocus: (f: SeedFocus | null) => void;

  startDownload: (input: {
    id: string;
    name: string;
    magnet: string;
    source?: SourceId;
    sizeBytes?: number;
  }) => void;
  // Opens the "download to" prompt (D) so this one download can land in a
  // folder other than the configured default.
  requestDownloadTo: (input: {
    id: string;
    name: string;
    magnet: string;
    source?: SourceId;
    sizeBytes?: number;
  }) => void;
  copyMagnet: (input: { name: string; magnet: string; infoHash?: string }) => void;
  openDownloadFolder: (dir: string) => void;
  // Copies the cached .torrent metadata into the item's download folder and
  // reports the outcome through the notice line.
  exportTorrent: (input: { id: string; name: string }) => void;

  notice: string | null;
  setNotice: (s: string | null) => void;

  quitAll: () => void;

  listRows: number;
  compact: boolean;
  contentWidth: number;
  cols: number;
  rows: number;
}

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("Store not available");
  return s;
}

const QUEUE_UPDATE_MS = 200;

function getQueueItems(queue: DownloadQueue): QueueItem[] {
  return queue.getItems();
}

function getQueueHistory(queue: DownloadQueue): HistoryItem[] {
  return queue.getHistory();
}

function seedEntry(seed: SeedItem): [string, SeedItem] {
  return [seed.id, seed];
}

function getSeedsById(queue: DownloadQueue): Map<string, SeedItem> {
  return new Map(queue.getSeeds().map(seedEntry));
}

/** Subscribe to queue updates and refresh a snapshot at most every 200ms. */
function useThrottledQueueSnapshot<T>(
  queue: DownloadQueue,
  getSnapshot: (queue: DownloadQueue) => T,
): T {
  const [snapshot, setSnapshot] = useState(() => getSnapshot(queue));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = (): void => {
      timer = null;
      setSnapshot(getSnapshot(queue));
    };
    const onUpdate = (): void => {
      if (timer) return;
      timer = setTimeout(flush, QUEUE_UPDATE_MS);
    };
    queue.on("update", onUpdate);
    onUpdate();
    return () => {
      queue.off("update", onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [queue, getSnapshot]);
  return snapshot;
}

export function useQueueItems(queue: DownloadQueue): QueueItem[] {
  return useThrottledQueueSnapshot(queue, getQueueItems);
}

export function useQueueHistory(queue: DownloadQueue): HistoryItem[] {
  return useThrottledQueueSnapshot(queue, getQueueHistory);
}

export function useSeeds(queue: DownloadQueue): Map<string, SeedItem> {
  return useThrottledQueueSnapshot(queue, getSeedsById);
}
