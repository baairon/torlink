import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedSearch } from "../sources/cache";
import { sourcesByGroup } from "../sources/registry";
import type { TorrentResult } from "../sources/types";
import { HttpError } from "../util/net";
import { runSearch } from "./search";

vi.mock("../sources/cache", () => ({ cachedSearch: vi.fn() }));

const searchMock = vi.mocked(cachedSearch);

function result(
  infoHash: string,
  seeders: number,
  added: number,
  source: TorrentResult["source"],
): TorrentResult {
  return {
    infoHash,
    name: infoHash,
    source,
    sizeBytes: 1,
    seeders,
    leechers: 0,
    added,
    magnet: `magnet:?xt=urn:btih:${infoHash}`,
  };
}

// A source that never answers and ignores its abort signal: the worst case,
// and the one the deadline has to hold against on its own.
const never = (): Promise<TorrentResult[]> => new Promise(() => {});

// Resolves when the signal handed to a source aborts, the moment a real
// source's requests are torn down.
function aborted(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    signal?.addEventListener("abort", () => resolve(), { once: true });
  });
}

const TIMED_OUT = { ok: false, count: 0, error: "timed out after 45s", code: "timeout" };

beforeEach(() => {
  searchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runSearch", () => {
  it("selects category sources and preserves partial failures", async () => {
    searchMock.mockImplementation(async (source) => {
      if (source.id === "yts") return [result("same", 10, 100, source.id)];
      if (source.id === "tpb-movies") {
        return [result("same", 20, 100, source.id), result("other", 15, 200, source.id)];
      }
      throw new HttpError(503, "source unavailable");
    });

    const execution = await runSearch({ query: "example movie", category: "movies" });
    const movieSourceIds = sourcesByGroup()
      .find(({ group }) => group === "Movies")!
      .sources.map(({ id }) => id);

    expect(searchMock.mock.calls.map(([source]) => source.id)).toEqual(movieSourceIds);
    expect(execution.exitCode).toBe(0);
    expect(execution.document.sources.yts).toEqual({ ok: true, count: 1, error: null, code: null });
    expect(execution.document.sources["x1337-movies"]).toEqual({
      ok: false,
      count: 0,
      error: "source unavailable",
      code: "HTTP 503",
    });
    expect(
      execution.document.results.map(({ infoHash, seeders }) => ({ infoHash, seeders })),
    ).toEqual([
      { infoHash: "same", seeders: 20 },
      { infoHash: "other", seeders: 15 },
    ]);
  });

  it("exits successfully when every source returns an empty result", async () => {
    searchMock.mockResolvedValue([]);

    const execution = await runSearch({ query: "legitimate empty search" });

    expect(execution.exitCode).toBe(0);
    expect(execution.document.category).toBe("all");
    expect(execution.document.count).toBe(0);
  });

  it("returns diagnostic output and exit 1 when every source fails", async () => {
    searchMock.mockRejectedValue(new Error("offline"));

    const execution = await runSearch({ query: "ubuntu", category: "games" });

    expect(execution.exitCode).toBe(1);
    expect(execution.document.results).toEqual([]);
    expect(execution.document.sources.fitgirl).toEqual({
      ok: false,
      count: 0,
      error: "offline",
      code: "no response",
    });
  });
});

describe("runSearch deadline", () => {
  it("prints what answered when another source stalls", async () => {
    vi.useFakeTimers();
    searchMock.mockImplementation(async (source, _query, opts) => {
      if (source.id === "yts") return [result("answered", 5, 100, source.id)];
      await aborted(opts?.signal);
      throw new HttpError(0, "aborted");
    });

    let done = false;
    const pending = runSearch({ query: "example movie", category: "movies" });
    void pending.then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(44_999);
    expect(done).toBe(false);
    // Sources that give up on the abort settle at the deadline itself.
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);

    const execution = await pending;
    const { yts, ...stalled } = execution.document.sources;
    expect(execution.exitCode).toBe(0);
    expect(execution.document.results.map(({ infoHash }) => infoHash)).toEqual(["answered"]);
    expect(yts).toEqual({ ok: true, count: 1, error: null, code: null });
    expect(Object.keys(stalled).length).toBeGreaterThan(0);
    for (const outcome of Object.values(stalled)) expect(outcome).toEqual(TIMED_OUT);
  });

  it("does not wait on a source that ignores the abort", async () => {
    vi.useFakeTimers();
    searchMock.mockImplementation((source) =>
      source.id === "yts" ? Promise.resolve([result("answered", 5, 100, source.id)]) : never(),
    );

    let done = false;
    const pending = runSearch({ query: "example movie", category: "movies" });
    void pending.then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(45_000);
    expect(done).toBe(false);
    expect(searchMock.mock.calls.every(([, , opts]) => opts?.signal?.aborted === true)).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(done).toBe(true);

    const execution = await pending;
    expect(execution.exitCode).toBe(0);
    expect(execution.document.count).toBe(1);
    expect(execution.document.sources["tpb-movies"]).toEqual(TIMED_OUT);
  });

  it("exits 1 with a diagnostic document when no source answers in time", async () => {
    vi.useFakeTimers();
    searchMock.mockImplementation(never);

    const pending = runSearch({ query: "example movie" });
    await vi.advanceTimersByTimeAsync(46_000);
    const execution = await pending;

    expect(execution.exitCode).toBe(1);
    expect(execution.document.results).toEqual([]);
    const outcomes = Object.values(execution.document.sources);
    expect(outcomes.length).toBeGreaterThan(0);
    for (const outcome of outcomes) expect(outcome).toEqual(TIMED_OUT);
  });

  it("keeps what a source hands back when it is cut short", async () => {
    vi.useFakeTimers();
    searchMock.mockImplementation(async (source, _query, opts) => {
      await aborted(opts?.signal);
      return [result("first-page", 0, 100, source.id)];
    });

    const pending = runSearch({ query: "example game", category: "games" });
    await vi.advanceTimersByTimeAsync(45_000);
    const execution = await pending;

    expect(execution.exitCode).toBe(0);
    expect(execution.document.sources.fitgirl).toEqual({
      ok: true,
      count: 1,
      error: null,
      code: null,
    });
    expect(execution.document.results.map(({ infoHash }) => infoHash)).toEqual(["first-page"]);
  });

  it("does not report an empty answer after the deadline as a successful search", async () => {
    vi.useFakeTimers();
    searchMock.mockImplementation(async (_source, _query, opts) => {
      await aborted(opts?.signal);
      return [];
    });

    const pending = runSearch({ query: "example show", category: "tv" });
    await vi.advanceTimersByTimeAsync(45_000);
    const execution = await pending;

    expect(execution.exitCode).toBe(1);
    expect(execution.document.count).toBe(0);
    for (const outcome of Object.values(execution.document.sources)) {
      expect(outcome).toEqual(TIMED_OUT);
    }
  });

  it("takes its deadline from timeoutMs", async () => {
    vi.useFakeTimers();
    searchMock.mockImplementation(async (_source, _query, opts) => {
      await aborted(opts?.signal);
      throw new HttpError(0, "aborted");
    });

    let done = false;
    const pending = runSearch({ query: "ubuntu", category: "games", timeoutMs: 5_000 });
    void pending.then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);

    const execution = await pending;
    expect(execution.document.sources.fitgirl).toEqual({
      ok: false,
      count: 0,
      error: "timed out after 5s",
      code: "timeout",
    });
  });

  // A deadline left pending would keep the process idling until it fired.
  it("drops the deadline once every source has answered", async () => {
    vi.useFakeTimers();
    searchMock.mockResolvedValue([]);

    const execution = await runSearch({ query: "ubuntu" });

    expect(execution.exitCode).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a caller's own abort as an ordinary failure", async () => {
    const ctrl = new AbortController();
    searchMock.mockImplementation(async (_source, _query, opts) => {
      await aborted(opts?.signal);
      throw new HttpError(0, "aborted");
    });

    const pending = runSearch({ query: "ubuntu", category: "games", signal: ctrl.signal });
    ctrl.abort();
    const execution = await pending;

    expect(execution.exitCode).toBe(1);
    expect(execution.document.sources.fitgirl).toEqual({
      ok: false,
      count: 0,
      error: "aborted",
      code: "no response",
    });
  });
});
