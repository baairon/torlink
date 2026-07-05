import { describe, it, expect, vi } from "vitest";
import { DownloadQueue } from "./queue";
import type { QueueItem } from "./types";

// add() drives the engine, which would spin up webtorrent and touch the
// network. Stub it (the way clipboard.test.ts stubs node:child_process) so
// these tests cover the queue's own bookkeeping. Kept out of queue.test.ts,
// whose tests prove they never reach the engine by construction.
vi.mock("./engine", () => ({
  TorrentEngine: class {
    add(): void {}
    remove(): void {}
    stats(): undefined {
      return undefined;
    }
    destroy(): void {}
  },
}));

function failedItem(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "t1",
    name: "Some Torrent",
    magnet: "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
    dir: "/downloads/a",
    status: "failed",
    progress: 40,
    totalBytes: 100,
    downloadedBytes: 40,
    speed: 0,
    peers: 0,
    error: "boom",
    addedAt: 1,
    ...over,
  };
}

const input = { id: "t1", name: "Some Torrent", magnet: failedItem().magnet };

describe("DownloadQueue.add retry semantics", () => {
  it("re-adds a failed item into the newly requested dir, dropping stale resume progress", () => {
    const q = new DownloadQueue();
    q.restore([failedItem()]);
    q.add(input, "/downloads/b");
    const it = q.getItems()[0]!;
    expect(it.status).toBe("downloading");
    expect(it.dir).toBe("/downloads/b");
    expect(it.progress).toBe(0);
    expect(it.downloadedBytes).toBe(0);
    expect(it.error).toBeUndefined();
    q.suspend();
  });

  it("keeps resume progress when a failed item retries into the same dir", () => {
    const q = new DownloadQueue();
    q.restore([failedItem()]);
    q.add(input, "/downloads/a");
    const it = q.getItems()[0]!;
    expect(it.status).toBe("downloading");
    expect(it.dir).toBe("/downloads/a");
    expect(it.progress).toBe(40);
    expect(it.downloadedBytes).toBe(40);
    q.suspend();
  });

  it("leaves an active download untouched when re-added with a different dir", () => {
    const q = new DownloadQueue();
    q.restore([failedItem({ status: "downloading", error: undefined })]);
    q.add(input, "/downloads/b");
    const it = q.getItems()[0]!;
    expect(it.dir).toBe("/downloads/a");
    expect(it.progress).toBe(40);
    q.suspend();
  });
});
