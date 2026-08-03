import { describe, it, expect, vi } from "vitest";
import { DownloadQueue } from "./queue";
import type { QueueItem } from "./types";

// Stub the engine (same approach as queue.add.test.ts) so these tests cover the
// queue's own concurrency bookkeeping without touching webtorrent/the network.
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

const mk = (n: number) => ({
  id: String(n).padStart(40, "0"),
  name: `T${n}`,
  magnet: `magnet:?xt=urn:btih:${String(n).padStart(40, "0")}`,
});
const statuses = (q: DownloadQueue): Record<string, string> =>
  Object.fromEntries(q.getItems().map((i) => [i.id, i.status]));

describe("DownloadQueue concurrent-download cap (TORLINK_MAX_DOWNLOADS)", () => {
  it("queues torrents beyond the cap, then promotes the oldest when a slot frees", () => {
    const q = new DownloadQueue({ maxDownloads: 2 });
    q.add(mk(1), "/d");
    q.add(mk(2), "/d");
    q.add(mk(3), "/d");

    expect(q.activeCount).toBe(2);
    let s = statuses(q);
    expect(s[mk(1).id]).toBe("downloading");
    expect(s[mk(2).id]).toBe("downloading");
    expect(s[mk(3).id]).toBe("queued");

    // Pausing an active download frees a slot → the queued one starts.
    q.pause(mk(1).id);
    expect(q.activeCount).toBe(2);
    s = statuses(q);
    expect(s[mk(1).id]).toBe("paused");
    expect(s[mk(3).id]).toBe("downloading");

    q.suspend();
  });

  it("defaults to unlimited (maxDownloads 0) — everything downloads at once", () => {
    const q = new DownloadQueue({ maxDownloads: 0 });
    q.add(mk(1), "/d");
    q.add(mk(2), "/d");
    q.add(mk(3), "/d");
    expect(q.activeCount).toBe(3);
    expect(Object.values(statuses(q)).every((v) => v === "downloading")).toBe(true);
    q.suspend();
  });

  it("respects the cap when restoring persisted downloads on boot", () => {
    const persisted = [1, 2, 3].map((n) => ({
      ...mk(n),
      source: undefined,
      dir: "/d",
      status: "downloading" as const,
      progress: 0,
      totalBytes: 0,
      downloadedBytes: 0,
      speed: 0,
      peers: 0,
      addedAt: n,
    }));
    const q = new DownloadQueue({ maxDownloads: 2 });
    q.restore(persisted);
    expect(q.activeCount).toBe(2);
    expect(statuses(q)[mk(3).id]).toBe("queued");
    q.suspend();
  });

  it("starts persisted queued items on restore when the cap is unset", () => {
    const persisted = [1, 2, 3].map(
      (n): QueueItem => ({
        ...mk(n),
        source: undefined,
        dir: "/d",
        status: n === 1 ? "downloading" : "queued",
        progress: 0,
        totalBytes: 0,
        downloadedBytes: 0,
        speed: 0,
        peers: 0,
        addedAt: n,
      }),
    );
    const q = new DownloadQueue({ maxDownloads: 0 });
    q.restore(persisted);
    expect(q.activeCount).toBe(3);
    expect(Object.values(statuses(q)).every((v) => v === "downloading")).toBe(true);
    q.suspend();
  });
});
