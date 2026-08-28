import { describe, it, expect, vi, afterEach } from "vitest";
import type { Source, SourceId, TorrentResult } from "./types";

const MAX_ENTRIES = 100;

function countingSource(id: SourceId = "nyaa"): Source & { calls: number } {
  const source = {
    id,
    label: id,
    homepage: "https://example.org",
    reportsHealth: true,
    calls: 0,
    search: async (query: string): Promise<TorrentResult[]> => {
      source.calls += 1;
      return [
        {
          infoHash: "a".repeat(40),
          name: query,
          sizeBytes: 1,
          seeders: 1,
          leechers: 0,
          source: id,
          magnet: `magnet:?xt=urn:btih:${"a".repeat(40)}`,
        },
      ];
    },
  };
  return source;
}

// The cache is module state, so each test starts from a fresh copy.
async function freshCache(): Promise<typeof import("./cache").cachedSearch> {
  vi.resetModules();
  return (await import("./cache")).cachedSearch;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("cachedSearch", () => {
  it("serves a repeat query from the cache", async () => {
    const cachedSearch = await freshCache();
    const source = countingSource();

    await cachedSearch(source, "dune");
    const again = await cachedSearch(source, "  DUNE ");

    expect(source.calls).toBe(1);
    expect(again[0]!.name).toBe("dune");
  });

  it("goes back to the source once the entry has aged out", async () => {
    vi.useFakeTimers();
    const cachedSearch = await freshCache();
    const source = countingSource();

    await cachedSearch(source, "dune");
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await cachedSearch(source, "dune");

    expect(source.calls).toBe(2);
  });

  it("keeps only the most recent entries instead of growing forever", async () => {
    const cachedSearch = await freshCache();
    const source = countingSource();

    for (let i = 0; i < MAX_ENTRIES + 10; i++) await cachedSearch(source, `query ${i}`);
    const filled = source.calls;

    // The newest is still there; the oldest was dropped to make room.
    await cachedSearch(source, `query ${MAX_ENTRIES + 9}`);
    expect(source.calls).toBe(filled);

    await cachedSearch(source, "query 0");
    expect(source.calls).toBe(filled + 1);
  });

  it("counts a refreshed entry as the newest, not the oldest", async () => {
    vi.useFakeTimers();
    const cachedSearch = await freshCache();
    const source = countingSource();

    for (let i = 0; i < MAX_ENTRIES; i++) await cachedSearch(source, `query ${i}`);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    // Refetching the oldest query moves it to the back of the queue, so the
    // entry evicted by the next insert is the one after it, not this one.
    await cachedSearch(source, "query 0");
    await cachedSearch(source, "brand new");
    const filled = source.calls;

    await cachedSearch(source, "query 0");
    expect(source.calls).toBe(filled);

    await cachedSearch(source, "query 1");
    expect(source.calls).toBe(filled + 1);
  });
});
