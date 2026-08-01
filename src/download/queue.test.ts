import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { DownloadQueue, strayDownload } from "./queue";
import type { HistoryItem } from "./history";
import { deleteTorrentMeta, saveTorrentMeta } from "./persist";

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

      expect(file).toBe(path.join(outDir, "Completed", "Some Torrent.torrent"));
      await expect(fs.readFile(file!)).resolves.toEqual(Buffer.from([5, 6, 7]));
    } finally {
      deleteTorrentMeta(item.id);
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

describe("DownloadQueue folder isolation", () => {
  it("routes active downloads to Downloads subfolder and seeds to Seeding subfolder", () => {
    const q = new DownloadQueue();
    let passedDir = "";
    const fakeEngine = (q as unknown as { engine: { add: (id: string, src: string, dir: string) => void } }).engine;
    fakeEngine.add = (_id, _src, dir) => {
      passedDir = dir;
    };

    q.add(
      {
        id: "iso1",
        name: "Iso Torrent",
        magnet: "magnet:?xt=urn:btih:2222222222222222222222222222222222222222",
      },
      "/base/download/path"
    );
    expect(passedDir).toBe(path.join("/base/download/path", "Downloads"));

    q.restoreHistory([h({ id: "seed1", dir: "/base/download/path" })]);
    q.startSeeding(h({ id: "seed1", dir: "/base/download/path" }));
    expect(passedDir).toBe(path.join("/base/download/path", "Seeding"));

    q.suspend();
  });

  it("automatically migrates existing legacy active download files from root to Downloads folder", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-migration-test-"));
    try {
      const legacyFile = path.join(tmpDir, "ActiveItem.mkv");
      await fs.writeFile(legacyFile, "content");
      expect(await fs.stat(legacyFile).then(() => true).catch(() => false)).toBe(true);

      const q = new DownloadQueue();
      const fakeEngine = (q as unknown as { engine: { add: () => void } }).engine;
      fakeEngine.add = () => {};

      q.restore([
        {
          id: "mig1",
          name: "ActiveItem.mkv",
          source: undefined,
          magnet: "magnet:?xt=urn:btih:3333333333333333333333333333333333333333",
          dir: tmpDir,
          status: "downloading",
          progress: 50,
          totalBytes: 100,
          downloadedBytes: 50,
          speed: 100,
          peers: 1,
          addedAt: Date.now(),
        },
      ]);

      const newFile = path.join(tmpDir, "Downloads", "ActiveItem.mkv");
      expect(await fs.stat(newFile).then(() => true).catch(() => false)).toBe(true);
      expect(await fs.stat(legacyFile).then(() => true).catch(() => false)).toBe(false);
      q.suspend();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("automatically migrates existing legacy seed files from root to Seeding folder on startSeeding", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-seedmig-test-"));
    try {
      const legacyFile = path.join(tmpDir, "SeedItem.mkv");
      await fs.writeFile(legacyFile, "seed content");

      const q = new DownloadQueue();
      const fakeEngine = (q as unknown as { engine: { add: () => void } }).engine;
      fakeEngine.add = () => {};

      const seedItem = h({ id: "seedmig1", name: "SeedItem.mkv", dir: tmpDir });
      q.restoreHistory([seedItem]);
      q.startSeeding(seedItem);

      const newFile = path.join(tmpDir, "Seeding", "SeedItem.mkv");
      expect(await fs.stat(newFile).then(() => true).catch(() => false)).toBe(true);
      expect(await fs.stat(legacyFile).then(() => true).catch(() => false)).toBe(false);
      q.suspend();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("migrates legacy file when metadata resolves a name", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-metamig-test-"));
    try {
      const legacyFile = path.join(tmpDir, "MetaResolved.mkv");
      await fs.writeFile(legacyFile, "meta content");

      const q = new DownloadQueue();
      let capturedHandlers: any;
      const fakeEngine = (q as unknown as { engine: { add: (id: string, src: string, dir: string, handlers: any) => void } }).engine;
      fakeEngine.add = (_id, _src, _dir, handlers) => {
        capturedHandlers = handlers;
      };

      q.add(
        {
          id: "meta1",
          name: "",
          magnet: "magnet:?xt=urn:btih:4444444444444444444444444444444444444444",
        },
        tmpDir
      );

      capturedHandlers.onMetadata({ name: "MetaResolved.mkv", total: 100, files: [] });

      const newFile = path.join(tmpDir, "Downloads", "MetaResolved.mkv");
      expect(await fs.stat(newFile).then(() => true).catch(() => false)).toBe(true);
      expect(await fs.stat(legacyFile).then(() => true).catch(() => false)).toBe(false);
      q.suspend();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("removes legacy file in root directory on queue.remove", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-legacyrm-test-"));
    try {
      const legacyFile = path.join(tmpDir, "LegacyToRemove.mkv");
      await fs.writeFile(legacyFile, "to be deleted");

      const q = new DownloadQueue();
      const fakeEngine = (q as unknown as { engine: { remove: (_id: string) => void } }).engine;
      fakeEngine.remove = () => {};

      q.restore([
        {
          id: "rm1",
          name: "LegacyToRemove.mkv",
          source: undefined,
          magnet: "magnet:?xt=urn:btih:5555555555555555555555555555555555555555",
          dir: tmpDir,
          status: "downloading",
          progress: 50,
          totalBytes: 100,
          downloadedBytes: 50,
          speed: 100,
          peers: 1,
          addedAt: Date.now(),
        },
      ]);

      await q.remove("rm1", { deleteFiles: true });

      expect(await fs.stat(legacyFile).then(() => true).catch(() => false)).toBe(false);
      q.suspend();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});




