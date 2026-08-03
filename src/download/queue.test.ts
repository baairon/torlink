import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { DownloadQueue, strayDownload } from "./queue";
import type { HistoryItem } from "./history";
import { deleteTorrentMeta, saveTorrentMeta } from "./persist";
import type { AddHandlers } from "./engine";

function h(over: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: "h1",
    name: "Some Download",
    magnet: "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
    dir: "/downloads",
    sizeBytes: 100,
    completedAt: 1,
    ...over,
  };
}

describe("DownloadQueue seeding", () => {
  it("refuses to seed an entry with no magnet (the only synchronous guard)", () => {
    const q = new DownloadQueue();
    q.startSeeding(h({ id: "h2", magnet: "" }));
    expect(q.getSeed("h2")?.status).toBe("missing");
    expect(q.seedingCount).toBe(0);
    q.suspend();
  });

  it("persistSync flushes every state file without touching the engine", () => {
    const q = new DownloadQueue();
    q.restoreHistory([h({ id: "h3" })]);
    // No engine work, so this never spins up webtorrent and never throws even
    // with a populated history.
    expect(() => q.persistSync()).not.toThrow();
  });

  it("restores a paused seed as paused and does not auto-start it", () => {
    const q = new DownloadQueue();
    q.restoreHistory([h({ id: "h4" })]);
    // A deliberately paused seed must come back paused (visible), not seeding,
    // and without spinning up the engine.
    q.restoreSeeds([{ id: "h4", status: "paused" }]);
    expect(q.getSeed("h4")?.status).toBe("paused");
    expect(q.seedingCount).toBe(0);
    q.suspend();
  });

  it("exports cached .torrent metadata for a history item", async () => {
    const q = new DownloadQueue();
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-queue-export-"));
    const item = h({ id: "h5", name: "Some/Torrent", dir: outDir });
    try {
      q.restoreHistory([item]);
      await saveTorrentMeta(item.id, new Uint8Array([5, 6, 7]));

      const file = await q.exportTorrentFile(item.id);

      expect(file).toBe(path.join(outDir, "Some Torrent.torrent"));
      await expect(fs.readFile(file!)).resolves.toEqual(Buffer.from([5, 6, 7]));
    } finally {
      deleteTorrentMeta(item.id);
      await fs.rm(outDir, { recursive: true, force: true });
      q.suspend();
    }
  });
});

describe("DownloadQueue.fetchAndExportTorrent", () => {
  it("exports cached metadata immediately, without touching the engine", async () => {
    const q = new DownloadQueue();
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-fetch-export-"));
    const fakeEngine = (q as unknown as { engine: { add: () => void } }).engine;
    fakeEngine.add = () => {
      throw new Error("must not touch the engine when metadata is cached");
    };
    try {
      await saveTorrentMeta("cached1", new Uint8Array([1, 2, 3]));
      const file = await q.fetchAndExportTorrent(
        {
          id: "cached1",
          name: "Cached Torrent",
          magnet: "magnet:?xt=urn:btih:cccccccccccccccccccccccccccccccccccccccc",
        },
        outDir,
      );
      expect(file).toBe(path.join(outDir, "Cached Torrent.torrent"));
      await expect(fs.readFile(file!)).resolves.toEqual(Buffer.from([1, 2, 3]));
    } finally {
      deleteTorrentMeta("cached1");
      await fs.rm(outDir, { recursive: true, force: true });
      q.suspend();
    }
  });

  it("skips a magnet already active in the queue instead of double-adding it", async () => {
    const q = new DownloadQueue();
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-fetch-export-"));
    const fakeEngine = (q as unknown as { engine: { add: () => void } }).engine;
    fakeEngine.add = () => {
      throw new Error("must not add a torrent that's already active in the queue");
    };
    (q as unknown as { items: Map<string, unknown> }).items.set("active1", {});
    try {
      const file = await q.fetchAndExportTorrent(
        {
          id: "active1",
          name: "Active",
          magnet: "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        outDir,
      );
      expect(file).toBeNull();
    } finally {
      await fs.rm(outDir, { recursive: true, force: true });
      q.suspend();
    }
  });

  it("fetches metadata over the network, tears the handle down immediately, then exports", async () => {
    const q = new DownloadQueue();
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-fetch-export-"));
    const removed: string[] = [];
    const fakeEngine = (
      q as unknown as {
        engine: {
          add: (id: string, magnet: string, dir: string, handlers: AddHandlers) => void;
          remove: (id: string) => void;
        };
      }
    ).engine;
    fakeEngine.add = (_id, _magnet, _dir, handlers) => {
      handlers.onMetadata?.({
        name: "Fresh Torrent",
        total: 100,
        files: 1,
        torrentFile: new Uint8Array([9, 9, 9]),
      });
    };
    fakeEngine.remove = (id) => removed.push(id);
    try {
      const file = await q.fetchAndExportTorrent(
        {
          id: "fresh1",
          name: "Fresh Torrent",
          magnet: "magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        outDir,
      );
      expect(file).toBe(path.join(outDir, "Fresh Torrent.torrent"));
      await expect(fs.readFile(file!)).resolves.toEqual(Buffer.from([9, 9, 9]));
      // Removed before export resolves: no file content ever hits disk.
      expect(removed).toEqual(["__meta__fresh1"]);
    } finally {
      deleteTorrentMeta("fresh1");
      await fs.rm(outDir, { recursive: true, force: true });
      q.suspend();
    }
  });

  it("resolves null and tears down the handle when the metadata fetch fails", async () => {
    const q = new DownloadQueue();
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-fetch-export-"));
    const removed: string[] = [];
    const fakeEngine = (
      q as unknown as {
        engine: {
          add: (id: string, magnet: string, dir: string, handlers: AddHandlers) => void;
          remove: (id: string) => void;
        };
      }
    ).engine;
    fakeEngine.add = (_id, _magnet, _dir, handlers) => {
      handlers.onError?.("no peers");
    };
    fakeEngine.remove = (id) => removed.push(id);
    try {
      const file = await q.fetchAndExportTorrent(
        {
          id: "gone1",
          name: "Gone",
          magnet: "magnet:?xt=urn:btih:dddddddddddddddddddddddddddddddddddddddd",
        },
        outDir,
      );
      expect(file).toBeNull();
      expect(removed).toEqual(["__meta__gone1"]);
    } finally {
      await fs.rm(outDir, { recursive: true, force: true });
      q.suspend();
    }
  });

  it("gives up after a metadata timeout and tears the handle down", async () => {
    const q = new DownloadQueue();
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-fetch-export-"));
    const removed: string[] = [];
    const fakeEngine = (
      q as unknown as {
        engine: {
          add: (id: string, magnet: string, dir: string, handlers: AddHandlers) => void;
          remove: (id: string) => void;
        };
      }
    ).engine;
    // A magnet with no peers: neither onMetadata nor onError ever fires.
    fakeEngine.add = () => {};
    fakeEngine.remove = (id) => removed.push(id);
    vi.useFakeTimers();
    try {
      const pending = q.fetchAndExportTorrent(
        {
          id: "stuck1",
          name: "Stuck",
          magnet: "magnet:?xt=urn:btih:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        },
        outDir,
      );
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await pending).toBeNull();
      expect(removed).toEqual(["__meta__stuck1"]);
    } finally {
      vi.useRealTimers();
      await fs.rm(outDir, { recursive: true, force: true });
      q.suspend();
    }
  });
});

describe("strayDownload (missing-file safety-net)", () => {
  it("ignores a present file being verified (disk read, no network speed)", () => {
    // Large file mid-verify: progress < 1 but network speed is 0.
    expect(strayDownload({ total: 50e9, progress: 0.4, speed: 0 })).toBe(false);
  });

  it("ignores a complete, healthy seed", () => {
    expect(strayDownload({ total: 8e9, progress: 1, speed: 0 })).toBe(false);
  });

  it("flags a seed that is actually pulling missing data off the network", () => {
    expect(strayDownload({ total: 8e9, progress: 0.2, speed: 2e6 })).toBe(true);
  });

  it("ignores a seed before metadata has arrived (total unknown)", () => {
    expect(strayDownload({ total: 0, progress: 0, speed: 0 })).toBe(false);
  });
});

describe("DownloadQueue error resilience on boot", () => {
  it("restore() marks item failed if engine.add throws synchronously", () => {
    const q = new DownloadQueue();
    // Spy on internal engine to force synchronous throw when add is called
    const fakeEngine = (q as unknown as { engine: { add: () => void } }).engine;
    fakeEngine.add = () => {
      throw new Error("Disk error during add");
    };

    expect(() =>
      q.restore([
        {
          id: "err1",
          name: "Broken Download",
          source: undefined,
          magnet: "magnet:?xt=urn:btih:1111111111111111111111111111111111111111",
          dir: "/downloads",
          status: "downloading",
          progress: 0,
          totalBytes: 100,
          downloadedBytes: 0,
          speed: 0,
          peers: 0,
          addedAt: Date.now(),
        },
      ])
    ).not.toThrow();

    const errItem = q.getItems().find((i) => i.id === "err1");
    expect(errItem?.status).toBe("failed");
    expect(errItem?.error).toContain("Disk error during add");
    q.suspend();
  });

  it("restoreSeeds() marks seed paused if engine.add throws synchronously", () => {
    const q = new DownloadQueue();
    q.restoreHistory([h({ id: "h-broken" })]);
    const fakeEngine = (q as unknown as { engine: { add: () => void } }).engine;
    fakeEngine.add = () => {
      throw new Error("Chunk store init failed");
    };

    expect(() =>
      q.restoreSeeds([{ id: "h-broken", status: "seeding" }])
    ).not.toThrow();

    expect(q.getSeed("h-broken")?.status).toBe("paused");
    q.suspend();
  });
});
