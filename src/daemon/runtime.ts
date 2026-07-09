// Headless runtime: drive the download queue without the Ink TUI.
//
// The TUI is one front-end over DownloadQueue; a seedbox needs another that has
// no terminal at all. This mirrors App.tsx's boot sequence (load config, restore
// queue/history/seeds) so a headless run resumes exactly what an interactive one
// would, then exposes a single addInput() the watch folder and HTTP API share.

import { promises as fs } from "node:fs";
import { loadConfig } from "../config/config";
import { DownloadQueue } from "../download/queue";
import { loadQueue, loadSeeds } from "../download/persist";
import { loadHistory } from "../download/history";
import { reconcileQueue } from "../download/reconcile";
import { parseInput } from "../sources/magnet";
import { magnetFromTorrentFile } from "../sources/torrentFile";

export interface Runtime {
  queue: DownloadQueue;
  downloadDir: string;
}

// Build a queue and restore persisted state, matching the TUI's boot order
// (history before seeds — seeds resolve against history). `downloadDir` falls
// back to the saved config's dir when the caller doesn't override it.
export async function startRuntime(overrideDir?: string): Promise<Runtime> {
  const cfg = await loadConfig();
  const queue = new DownloadQueue();
  queue.setTrackers(cfg.trackers);
  queue.restore(reconcileQueue(await loadQueue()));
  queue.restoreHistory(await loadHistory());
  queue.restoreSeeds(await loadSeeds());
  const downloadDir = overrideDir && overrideDir.trim() ? overrideDir.trim() : cfg.downloadDir;
  return { queue, downloadDir };
}

export type AddOutcome = "added" | "duplicate" | "invalid";

// Turn a magnet URI, bare info hash, or a path to a .torrent file into a queued
// download. Deduplicates by info hash (the queue's own id), so re-submitting the
// same torrent is a no-op rather than a restart. Never throws — bad input is
// reported as "invalid" so callers (a watcher, an HTTP handler) can fail soft.
export async function addInput(runtime: Runtime, input: string): Promise<AddOutcome> {
  const trimmed = input.trim();
  const parsed = /\.torrent$/i.test(trimmed)
    ? await magnetFromTorrentFile(trimmed)
    : parseInput(trimmed);
  if (!parsed) return "invalid";
  if (runtime.queue.has(parsed.infoHash)) return "duplicate";
  await fs.mkdir(runtime.downloadDir, { recursive: true }).catch(() => {});
  runtime.queue.add(
    { id: parsed.infoHash, name: parsed.name, magnet: parsed.magnet },
    runtime.downloadDir,
  );
  return "added";
}
