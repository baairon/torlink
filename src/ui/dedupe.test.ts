import { describe, it, expect } from "vitest";
import { dedupeResults } from "./dedupe";
import { buildMagnet } from "../sources/magnet";
import type { SourceId, TorrentResult } from "../sources/types";

const HASH = "abcdef0123456789abcdef0123456789abcdef01";

function row(over: Partial<TorrentResult> & { source: SourceId }): TorrentResult {
  return {
    infoHash: HASH,
    name: "Some Release 1080p",
    sizeBytes: 1_000_000,
    seeders: 0,
    leechers: 0,
    magnet: buildMagnet(HASH, "Some Release 1080p"),
    ...over,
  };
}

function trackers(magnet: string): string[] {
  return new URL(magnet).searchParams.getAll("tr");
}

describe("dedupeResults", () => {
  it("leaves distinct hashes alone", () => {
    const other = "0123456789abcdef0123456789abcdef01234567";
    const out = dedupeResults([row({ source: "nyaa" }), row({ source: "yts", infoHash: other })]);
    expect(out).toHaveLength(2);
  });

  it("keeps the healthiest row's own fields", () => {
    const out = dedupeResults([
      row({ source: "tpb-movies", seeders: 3, name: "TPB name" }),
      row({ source: "x1337-movies", seeders: 90, name: "1337x name" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.seeders).toBe(90);
    expect(out[0]!.source).toBe("x1337-movies");
    expect(out[0]!.name).toBe("1337x name");
  });

  it("carries the losing row's trackers into the surviving magnet", () => {
    // The row 1337x returns carries the torrent's own announce list; the row
    // buildMagnet() writes carries only torlink's public defaults. Whichever
    // wins on seeders, both lists have to survive.
    const own = "udp://private.example:6969/announce/passkey";
    const out = dedupeResults([
      row({ source: "tpb-movies", seeders: 90 }),
      row({ source: "x1337-movies", seeders: 3, magnet: buildMagnet(HASH, "x", [own]) }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.seeders).toBe(90);
    expect(trackers(out[0]!.magnet)).toContain(own);
    expect(trackers(out[0]!.magnet)).toContain("udp://tracker.opentrackr.org:1337/announce");
  });

  it("adds no duplicate trackers and no duplicate rows for three sources", () => {
    const a = "udp://a.example:6969/announce";
    const b = "udp://b.example:6969/announce";
    const out = dedupeResults([
      row({ source: "tpb-movies", seeders: 1, magnet: buildMagnet(HASH, "x", [a]) }),
      row({ source: "yts", seeders: 5, magnet: buildMagnet(HASH, "x", [b]) }),
      row({ source: "x1337-movies", seeders: 2, magnet: buildMagnet(HASH, "x", [a]) }),
    ]);
    expect(out).toHaveLength(1);
    const tr = trackers(out[0]!.magnet);
    expect(tr).toContain(a);
    expect(tr).toContain(b);
    expect(new Set(tr).size).toBe(tr.length);
  });

  it("backfills numFiles and added only where the winner has none", () => {
    const out = dedupeResults([
      row({ source: "yts", seeders: 90, added: 1_700_000_000 }),
      row({ source: "eztv", seeders: 3, numFiles: 7, added: 1_600_000_000 }),
    ]);
    expect(out[0]!.numFiles).toBe(7);
    expect(out[0]!.added).toBe(1_700_000_000);
  });

  it("keeps the first row when seeders tie", () => {
    const out = dedupeResults([
      row({ source: "nyaa", seeders: 10 }),
      row({ source: "subsplease", seeders: 10 }),
    ]);
    expect(out[0]!.source).toBe("nyaa");
  });
});
