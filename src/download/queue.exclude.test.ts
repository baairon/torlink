import { describe, it, expect, vi, beforeEach } from "vitest";
import { DownloadQueue } from "./queue";

// Capture what the queue hands the engine so we can assert the exclusion list
// is forwarded (add's 6th argument).
const addCalls: unknown[][] = [];
const reselectCalls: unknown[][] = [];
let reselectReturn: number | null = 400;

vi.mock("./engine", () => ({
  message: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  TorrentEngine: class {
    add(...args: unknown[]): void {
      addCalls.push(args);
    }
    reselect(...args: unknown[]): number | null {
      reselectCalls.push(args);
      return reselectReturn;
    }
    remove(): void {}
    stats(): undefined {
      return undefined;
    }
    destroy(): void {}
  },
}));

beforeEach(() => {
  addCalls.length = 0;
  reselectCalls.length = 0;
  reselectReturn = 400;
});

const base = {
  id: "t1",
  name: "Season Pack",
  magnet: "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
};

describe("DownloadQueue file exclusion", () => {
  it("stores excludedFiles on the item and forwards them to the engine", () => {
    const q = new DownloadQueue();
    q.add({ ...base, excludedFiles: [1, 3] }, "/dl");
    const it = q.getItems()[0]!;
    expect(it.excludedFiles).toEqual([1, 3]);
    // engine.add(id, magnet, dir, handlers, trackers, exclude)
    expect(addCalls[0]![5]).toEqual([1, 3]);
    q.suspend();
  });

  it("normalizes an empty exclusion list to undefined (download everything)", () => {
    const q = new DownloadQueue();
    q.add({ ...base, excludedFiles: [] }, "/dl");
    const it = q.getItems()[0]!;
    expect(it.excludedFiles).toBeUndefined();
    expect(addCalls[0]![5]).toBeUndefined();
    q.suspend();
  });

  it("re-applies the persisted exclusions when a paused item resumes", () => {
    const q = new DownloadQueue();
    q.add({ ...base, excludedFiles: [2] }, "/dl");
    q.pause("t1");
    addCalls.length = 0;
    q.resume("t1");
    expect(addCalls[0]![5]).toEqual([2]);
    q.suspend();
  });

  it("reselect() on a live download applies to the engine and updates totalBytes", () => {
    const q = new DownloadQueue();
    q.add(base, "/dl"); // starts downloading, no exclusions
    reselectReturn = 400;
    const ok = q.reselect("t1", [1]);
    expect(ok).toBe(true);
    expect(reselectCalls[0]).toEqual(["t1", [1]]);
    const it = q.getItems()[0]!;
    expect(it.excludedFiles).toEqual([1]);
    expect(it.totalBytes).toBe(400);
    q.suspend();
  });

  it("reselect() on a paused download stores exclusions without touching the engine", () => {
    const q = new DownloadQueue();
    q.add(base, "/dl");
    q.pause("t1");
    reselectCalls.length = 0;
    const ok = q.reselect("t1", [2]);
    expect(ok).toBe(true);
    expect(reselectCalls).toHaveLength(0); // no live torrent to touch
    expect(q.getItems()[0]!.excludedFiles).toEqual([2]);
    q.suspend();
  });

  it("reselect() returns false for an unknown id", () => {
    const q = new DownloadQueue();
    expect(q.reselect("ghost", [0])).toBe(false);
    q.suspend();
  });

  it("forwards a history item's exclusions when it is re-seeded", () => {
    const q = new DownloadQueue();
    q.restoreHistory([
      {
        id: "t1",
        name: base.name,
        sizeBytes: 100,
        magnet: base.magnet,
        dir: "/dl",
        completedAt: 1,
        excludedFiles: [4],
      },
    ]);
    q.startSeeding(q.getHistory()[0]!);
    expect(addCalls[0]![5]).toEqual([4]);
    q.suspend();
  });
});
