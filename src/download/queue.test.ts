import { describe, it, expect } from "vitest";
import { DownloadQueue, strayDownload } from "./queue";
import type { HistoryItem } from "./history";
import type { QueueItem } from "./types";

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

function qi(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "q1",
    name: "Some Download",
    magnet: "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
    dir: "/downloads",
    status: "paused",
    progress: 40,
    totalBytes: 100,
    downloadedBytes: 40,
    speed: 0,
    peers: 0,
    addedAt: 1,
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

describe("DownloadQueue.setFileSelected", () => {
  it("deselecting an index adds it to item.deselected, sorted", () => {
    const q = new DownloadQueue();
    q.restore([qi({ id: "q1" })]);
    q.setFileSelected("q1", 2, false);
    expect(q.getItems().find((it) => it.id === "q1")?.deselected).toEqual([2]);
    q.setFileSelected("q1", 0, false);
    expect(q.getItems().find((it) => it.id === "q1")?.deselected).toEqual([0, 2]);
    q.suspend();
  });

  it("re-selecting a deselected index removes it", () => {
    const q = new DownloadQueue();
    q.restore([qi({ id: "q1", deselected: [0, 1, 2] })]);
    q.setFileSelected("q1", 1, true);
    expect(q.getItems().find((it) => it.id === "q1")?.deselected).toEqual([0, 2]);
    q.suspend();
  });

  it("toggling multiple indices keeps the array sorted and unique", () => {
    const q = new DownloadQueue();
    q.restore([qi({ id: "q1" })]);
    q.setFileSelected("q1", 3, false);
    q.setFileSelected("q1", 1, false);
    q.setFileSelected("q1", 1, false); // duplicate toggle, no-op on the set
    q.setFileSelected("q1", 0, false);
    expect(q.getItems().find((it) => it.id === "q1")?.deselected).toEqual([0, 1, 3]);
    q.suspend();
  });

  it("is a no-op for an unknown id", () => {
    const q = new DownloadQueue();
    q.restore([qi({ id: "q1" })]);
    expect(() => q.setFileSelected("does-not-exist", 0, false)).not.toThrow();
    expect(q.getItems().find((it) => it.id === "q1")?.deselected).toBeUndefined();
    q.suspend();
  });

  it("behaves the same array-only way for a failed item", () => {
    const q = new DownloadQueue();
    q.restore([qi({ id: "q1", status: "failed" })]);
    q.setFileSelected("q1", 4, false);
    expect(q.getItems().find((it) => it.id === "q1")?.deselected).toEqual([4]);
    q.setFileSelected("q1", 4, true);
    expect(q.getItems().find((it) => it.id === "q1")?.deselected).toEqual([]);
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
