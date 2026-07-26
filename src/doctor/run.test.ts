import { describe, it, expect } from "vitest";
import { probeAll, probeSource, runDoctor } from "./run";
import type { SearchOptions, Source, SourceId, TorrentResult } from "../sources/types";

const HASH = "b".repeat(40);

function row(over: Partial<TorrentResult> = {}): TorrentResult {
  return {
    infoHash: HASH,
    name: "Latest Release",
    sizeBytes: 2048,
    seeders: 9,
    leechers: 2,
    source: "yts",
    magnet: `magnet:?xt=urn:btih:${HASH}`,
    ...over,
  };
}

function source(
  id: SourceId,
  label: string,
  search: (query: string, opts?: SearchOptions) => Promise<TorrentResult[]>,
): Source {
  return { id, label, homepage: "https://example.test", reportsHealth: true, search };
}

describe("probeSource", () => {
  it("reports a working source as ok with its row counts", async () => {
    const s = source("yts", "YTS", async () => [row(), row()]);
    const r = await probeSource(s, 1000);
    expect(r).toMatchObject({ id: "yts", label: "YTS", status: "ok", rows: 2, usable: 2 });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it("reports a source that answers every probe with nothing as empty, not as an error", async () => {
    const r = await probeSource(
      source("eztv", "EZTV", async () => []),
      1000,
    );
    expect(r).toMatchObject({ status: "empty", rows: 0, usable: 0 });
    expect(r.error).toBeUndefined();
  });

  it("falls back to a search term for a source with no browse feed", async () => {
    const seen: string[] = [];
    const s = source("bittorrented", "BitTorrented", async (q) => {
      seen.push(q);
      return q.trim() ? [row()] : [];
    });
    expect(await probeSource(s, 1000)).toMatchObject({ status: "ok", query: "the", rows: 1 });
    expect(seen).toEqual(["", "the"]);
  });

  it("stops after the blank probe when it already produced rows", async () => {
    const seen: string[] = [];
    const s = source("yts", "YTS", async (q) => {
      seen.push(q);
      return [row()];
    });
    expect(await probeSource(s, 1000)).toMatchObject({ status: "ok", query: "" });
    expect(seen).toEqual([""]);
  });

  it("does not retry a source that failed, since the host already answered", async () => {
    let calls = 0;
    const s = source("fitgirl", "FitGirl", async () => {
      calls++;
      throw new Error("down");
    });
    expect(await probeSource(s, 1000)).toMatchObject({ status: "failed" });
    expect(calls).toBe(1);
  });

  it("reports a source whose rows stopped parsing as malformed", async () => {
    const s = source("nyaa", "Nyaa", async () => [row({ infoHash: "" }), row({ magnet: "" })]);
    expect(await probeSource(s, 1000)).toMatchObject({ status: "malformed", rows: 2, usable: 0 });
  });

  it("catches a throwing source instead of letting it escape", async () => {
    const s = source("fitgirl", "FitGirl", async () => {
      throw new Error("FitGirl returned 503");
    });
    expect(await probeSource(s, 1000)).toMatchObject({
      status: "failed",
      error: "FitGirl returned 503",
    });
  });

  it("catches a source that throws synchronously", async () => {
    const s = source("subsplease", "SubsPlease", (() => {
      throw new Error("boom");
    }) as Source["search"]);
    expect(await probeSource(s, 1000)).toMatchObject({ status: "failed", error: "boom" });
  });

  it("gives up on a hung source and aborts its signal", async () => {
    let seen: AbortSignal | undefined;
    const s = source("tpb-movies", "The Pirate Bay", (_q, opts) => {
      seen = opts?.signal;
      return new Promise<TorrentResult[]>(() => {});
    });
    const r = await probeSource(s, 20);
    expect(r).toMatchObject({ status: "failed", error: "timed out after 20ms" });
    expect(seen?.aborted).toBe(true);
  });

  it("does not let a source that rejects after the timeout escape as an unhandled rejection", async () => {
    const s = source(
      "x1337-movies",
      "1337x",
      () =>
        new Promise<TorrentResult[]>((_res, rej) => setTimeout(() => rej(new Error("late")), 30)),
    );
    expect(await probeSource(s, 10)).toMatchObject({ status: "failed" });
    await new Promise((res) => setTimeout(res, 60));
  });
});

describe("probeAll", () => {
  it("probes every source even when one of them fails", async () => {
    const reports = await probeAll(
      [
        source("yts", "YTS", async () => [row()]),
        source("eztv", "EZTV", async () => {
          throw new Error("down");
        }),
        source("nyaa", "Nyaa", async () => [row()]),
      ],
      1000,
    );
    expect(reports.map((r) => r.status)).toEqual(["ok", "failed", "ok"]);
  });
});

describe("runDoctor", () => {
  it("prints a table and exits 0 when every source is healthy", async () => {
    const lines: string[] = [];
    const code = await runDoctor({
      sources: [source("yts", "YTS", async () => [row()])],
      timeoutMs: 1000,
      out: (l) => lines.push(l),
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("all 1 sources healthy");
  });

  it("exits 1 when a source is unhealthy, so a scheduled run fails", async () => {
    const lines: string[] = [];
    const code = await runDoctor({
      sources: [source("yts", "YTS", async () => [row()]), source("eztv", "EZTV", async () => [])],
      timeoutMs: 1000,
      out: (l) => lines.push(l),
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("1 of 2 sources unhealthy: eztv");
  });

  it("prints machine readable JSON with --json", async () => {
    const lines: string[] = [];
    await runDoctor({
      json: true,
      sources: [source("yts", "YTS", async () => [row()])],
      timeoutMs: 1000,
      out: (l) => lines.push(l),
    });
    const parsed = JSON.parse(lines.join("\n")) as { id: string; status: string }[];
    expect(parsed).toMatchObject([{ id: "yts", status: "ok" }]);
  });

  it("probes the latest feed first, so a healthy source costs exactly one request", async () => {
    const seen: string[] = [];
    await runDoctor({
      sources: [
        source("yts", "YTS", async (q) => {
          seen.push(q);
          return [row()];
        }),
      ],
      timeoutMs: 1000,
      out: () => {},
    });
    expect(seen).toEqual([""]);
  });
});
