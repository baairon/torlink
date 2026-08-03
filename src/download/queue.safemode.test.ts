import { describe, expect, it } from "vitest";
import { DownloadQueue } from "./queue";
import { armBootMarker, wasBootInterrupted } from "./bootguard";
import type { HistoryItem } from "./history";
import type { QueueItem } from "./types";

function item(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "q1",
    name: "Some Download",
    magnet: "magnet:?xt=urn:btih:1111111111111111111111111111111111111111",
    dir: "/downloads",
    status: "downloading",
    progress: 0,
    totalBytes: 100,
    downloadedBytes: 0,
    speed: 0,
    peers: 0,
    addedAt: 1,
    ...over,
  };
}

function h(over: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: "h1",
    name: "Some Download",
    magnet: "magnet:?xt=urn:btih:2222222222222222222222222222222222222222",
    dir: "/downloads",
    sizeBytes: 100,
    completedAt: 1,
    ...over,
  };
}

// Inject a spy engine whose add() also throws: safe mode must not merely
// survive engine failures, it must never reach the engine at all.
function coldEngine(q: DownloadQueue): { adds: () => number } {
  let n = 0;
  const eng = (q as unknown as { engine: { add: () => void } }).engine;
  eng.add = () => {
    n++;
    throw new Error("engine must stay cold in safe mode");
  };
  return { adds: () => n };
}

describe("DownloadQueue safe-mode restore (crash-boot breaker)", () => {
  it("restores active and queued items as paused without touching the engine", () => {
    const q = new DownloadQueue();
    const engine = coldEngine(q);
    q.restore(
      [
        item({ id: "a", status: "downloading" }),
        item({ id: "b", status: "queued" }),
        item({ id: "c", status: "failed", error: "boom" }),
        item({ id: "d", status: "paused" }),
      ],
      { safe: true },
    );

    expect(engine.adds()).toBe(0);
    const by = new Map(q.getItems().map((it) => [it.id, it.status]));
    expect(by.get("a")).toBe("paused");
    expect(by.get("b")).toBe("paused");
    expect(by.get("c")).toBe("failed");
    expect(by.get("d")).toBe("paused");
    q.suspend();
  });

  it("restores persisted seeders as paused seeds without touching the engine", () => {
    const q = new DownloadQueue();
    const engine = coldEngine(q);
    q.restoreHistory([h({ id: "s1" }), h({ id: "s2" })]);
    q.restoreSeeds(
      [
        { id: "s1", status: "seeding" },
        { id: "s2", status: "paused" },
      ],
      { safe: true },
    );

    expect(engine.adds()).toBe(0);
    expect(q.getSeed("s1")?.status).toBe("paused");
    expect(q.getSeed("s2")?.status).toBe("paused");
    expect(q.seedingCount).toBe(0);
    q.suspend();
  });

  it("default restore still starts engines (safe mode is opt-in)", () => {
    const q = new DownloadQueue();
    let adds = 0;
    const eng = (q as unknown as { engine: { add: () => void } }).engine;
    eng.add = () => {
      adds++;
    };
    q.restore([item({ id: "a", status: "downloading" })]);
    expect(adds).toBe(1);
    q.suspend();
  });

  it("persistSync disarms the boot marker (a clean flush proves a healthy run)", () => {
    const q = new DownloadQueue();
    armBootMarker();
    expect(wasBootInterrupted()).toBe(true);
    q.persistSync();
    expect(wasBootInterrupted()).toBe(false);
  });
});
