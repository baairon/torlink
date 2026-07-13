import { describe, it, expect, vi, beforeEach } from "vitest";
import { DownloadQueue } from "./queue";
import type { AddHandlers } from "./engine";

// Same stub approach as queue.add.test.ts, extended to capture the handlers
// each add() registers so tests can fire onDone (completion) themselves, and
// to serve a canned file list for the subtitle hook.
const state = vi.hoisted(() => ({
  handlers: new Map<string, unknown>(),
  files: [{ path: "Show.S01E01.1080p.WEB.mkv", length: 300 * 1024 * 1024 }],
}));

vi.mock("./engine", () => ({
  TorrentEngine: class {
    add(id: string, _source: string, _dir: string, handlers: unknown): void {
      state.handlers.set(id, handlers);
    }
    remove(): void {}
    stats(): undefined {
      return undefined;
    }
    files(): { path: string; length: number }[] {
      return state.files;
    }
    destroy(): void {}
  },
}));

const fetchSubs = vi.hoisted(() => vi.fn(async (): Promise<number | null> => 2));
vi.mock("../subtitles/index", () => ({ fetchSubtitlesForDownload: fetchSubs }));

const MAGNET = "magnet:?xt=urn:btih:0000000000000000000000000000000000000000";

function onDone(id: string): void {
  (state.handlers.get(id) as AddHandlers).onDone!();
}

beforeEach(() => {
  fetchSubs.mockClear();
  state.handlers.clear();
});

describe("DownloadQueue subtitle hook", () => {
  it("complete() triggers exactly one subtitle fetch with the configured lang", async () => {
    const q = new DownloadQueue();
    q.setSubtitleLang("he");
    const events: Array<[string, number, string]> = [];
    q.on("subtitles", (name: string, count: number, lang: string) =>
      events.push([name, count, lang]),
    );

    q.add({ id: "t1", name: "Show.S01E01", magnet: MAGNET, source: "eztv" }, "/downloads/a");
    onDone("t1");

    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(fetchSubs).toHaveBeenCalledTimes(1);
    expect(fetchSubs).toHaveBeenCalledWith({
      name: "Show.S01E01",
      dir: "/downloads/a",
      source: "eztv",
      files: state.files,
      lang: "he",
    });
    expect(events).toEqual([["Show.S01E01", 2, "he"]]);

    // A second onDone is the seed-verification path, never a second fetch.
    onDone("t1");
    await Promise.resolve();
    expect(fetchSubs).toHaveBeenCalledTimes(1);
    q.suspend();
  });

  it("a null result (never searched) emits no subtitles event", async () => {
    fetchSubs.mockResolvedValueOnce(null);
    const q = new DownloadQueue();
    const events: unknown[] = [];
    q.on("subtitles", (...args: unknown[]) => events.push(args));
    const completed: string[] = [];
    q.on("completed", (name: string) => completed.push(name));

    q.add({ id: "t3", name: "Elden.Ring.Repack", magnet: MAGNET, source: "fitgirl" }, "/downloads/a");
    onDone("t3");

    await vi.waitFor(() => expect(fetchSubs).toHaveBeenCalledTimes(1));
    // Let the async fetchSubs hook settle fully before asserting silence.
    await new Promise((r) => setImmediate(r));
    expect(events).toEqual([]);
    expect(completed).toEqual(["Elden.Ring.Repack"]);
    q.suspend();
  });

  it("a rejecting fetch leaves the item completed + seeding and emits count 0", async () => {
    fetchSubs.mockRejectedValueOnce(new Error("boom"));
    const q = new DownloadQueue();
    const events: Array<[string, number, string]> = [];
    q.on("subtitles", (name: string, count: number, lang: string) =>
      events.push([name, count, lang]),
    );
    const completed: string[] = [];
    q.on("completed", (name: string) => completed.push(name));

    q.add({ id: "t2", name: "Show.S01E02", magnet: MAGNET, source: "eztv" }, "/downloads/a");
    onDone("t2");

    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events).toEqual([["Show.S01E02", 0, "en"]]);
    expect(completed).toEqual(["Show.S01E02"]);
    expect(q.has("t2")).toBe(false);
    expect(q.getSeed("t2")?.status).toBe("seeding");
    q.suspend();
  });
});
