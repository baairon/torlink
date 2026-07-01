import { describe, it, expect } from "vitest";
import { DownloadQueue, strayDownload } from "./queue";
import type { HistoryItem } from "./history";

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

describe("DownloadQueue selective download", () => {
  it("add with selectedIndices stores indices and processes selective stats on metadata", () => {
    const q = new DownloadQueue();
    q.add(
      {
        id: "sel1",
        name: "Selective Item",
        magnet: "magnet:?xt=urn:btih:1111111111111111111111111111111111111111",
        selectedIndices: [0],
      },
      "/downloads",
    );
    const items = q.getItems();
    const item = items.find((i) => i.id === "sel1");
    expect(item).toBeDefined();
    expect(item?.status).toBe("downloading");
    expect(item?.selectedIndices).toEqual([0]);
    expect(q.activeCount).toBe(1);

    // Trigger metadata handler mock call
    const handlers = q["engineHandlers"]("sel1");
    handlers.onMetadata?.({
      name: "Selective Item",
      total: 300,
      files: 2,
      fileList: [
        { path: "f1.txt", length: 100 },
        { path: "f2.txt", length: 200 },
      ],
      torrentFile: new Uint8Array(),
    });

    const updated = q.getItems().find((i) => i.id === "sel1");
    expect(updated?.totalBytes).toBe(100);
    expect(updated?.fileList?.[0]?.selected).toBe(true);
    expect(updated?.fileList?.[1]?.selected).toBe(false);

    q.suspend();
  });
});
