import { describe, it, expect } from "vitest";
import {
  cleanError,
  exitCode,
  formatReport,
  gradeRows,
  isUsableRow,
  type ProbeReport,
} from "./probe";
import type { TorrentResult } from "../sources/types";

const HASH = "a".repeat(40);

function row(over: Partial<TorrentResult> = {}): TorrentResult {
  return {
    infoHash: HASH,
    name: "Some Release 1080p",
    sizeBytes: 1024,
    seeders: 3,
    leechers: 1,
    source: "yts",
    magnet: `magnet:?xt=urn:btih:${HASH}`,
    ...over,
  };
}

function report(over: Partial<ProbeReport> = {}): ProbeReport {
  return {
    id: "yts",
    label: "YTS",
    status: "ok",
    query: "",
    rows: 10,
    usable: 10,
    ms: 120,
    ...over,
  };
}

describe("isUsableRow", () => {
  it("accepts a well formed row", () => {
    expect(isUsableRow(row())).toBe(true);
  });

  it("accepts zero seeders and zero size, which sources without swarm data report", () => {
    expect(isUsableRow(row({ seeders: 0, leechers: 0, sizeBytes: 0 }))).toBe(true);
  });

  it("rejects a row whose info hash stopped parsing", () => {
    expect(isUsableRow(row({ infoHash: "" }))).toBe(false);
    expect(isUsableRow(row({ infoHash: "not-a-hash" }))).toBe(false);
  });

  it("rejects a row with a blank name", () => {
    expect(isUsableRow(row({ name: "   " }))).toBe(false);
  });

  it("rejects a row whose magnet is not a magnet", () => {
    expect(isUsableRow(row({ magnet: "https://example.test/x.torrent" }))).toBe(false);
  });

  it("rejects non-finite or negative numbers", () => {
    expect(isUsableRow(row({ sizeBytes: Number.NaN }))).toBe(false);
    expect(isUsableRow(row({ seeders: -1 }))).toBe(false);
  });
});

describe("gradeRows", () => {
  it("grades a full page of good rows as ok", () => {
    expect(gradeRows([row(), row(), row()])).toEqual({ status: "ok", rows: 3, usable: 3 });
  });

  it("grades no rows at all as empty", () => {
    expect(gradeRows([])).toEqual({ status: "empty", rows: 0, usable: 0 });
  });

  it("grades a page that mostly stopped parsing as malformed", () => {
    const rows = [row(), row({ infoHash: "" }), row({ infoHash: "" }), row({ magnet: "" })];
    expect(gradeRows(rows)).toEqual({ status: "malformed", rows: 4, usable: 1 });
  });

  it("still calls a half-usable page ok, so ordinary lossy rows are not an alarm", () => {
    expect(gradeRows([row(), row({ name: "" })])).toMatchObject({ status: "ok", usable: 1 });
  });
});

describe("exitCode", () => {
  it("is 0 when every source is healthy", () => {
    expect(exitCode([report(), report({ id: "eztv", label: "EZTV" })])).toBe(0);
  });

  it("is 1 when any source is unhealthy", () => {
    expect(exitCode([report(), report({ status: "empty" })])).toBe(1);
    expect(exitCode([report({ status: "failed" })])).toBe(1);
    expect(exitCode([report({ status: "malformed" })])).toBe(1);
  });
});

describe("cleanError", () => {
  it("reads the message off an Error", () => {
    expect(cleanError(new Error("EZTV returned 502"))).toBe("EZTV returned 502");
  });

  it("strips control characters a hijacked source could smuggle into the terminal", () => {
    expect(cleanError(new Error("bad\u001b]0;pwned\u0007end"))).toBe("bad]0;pwnedend");
  });

  it("truncates a long server response", () => {
    expect(cleanError(new Error("x".repeat(500))).length).toBeLessThanOrEqual(120);
  });

  it("never returns an empty string", () => {
    expect(cleanError(new Error(""))).toBe("unknown error");
  });
});

describe("formatReport", () => {
  it("lists every source with its counts and names the unhealthy ones", () => {
    const out = formatReport([
      report(),
      report({
        id: "eztv",
        label: "EZTV",
        status: "failed",
        rows: 0,
        usable: 0,
        error: "HTTP 502",
      }),
    ]);
    expect(out).toContain("source");
    expect(out).toContain("yts");
    expect(out).toContain("HTTP 502");
    expect(out).toContain("1 of 2 sources unhealthy: eztv");
  });

  it("keys rows by source id, since two sources can share a label", () => {
    const out = formatReport([
      report({ id: "tpb-movies", label: "TPB" }),
      report({ id: "tpb-tv", label: "TPB" }),
    ]);
    expect(out).toContain("tpb-movies");
    expect(out).toContain("tpb-tv");
  });

  it("says which fallback query a search-only source needed", () => {
    expect(
      formatReport([report({ id: "bittorrented", label: "BitTorrented", query: "the" })]),
    ).toContain('search only, matched on "the"');
  });

  it("says so plainly when everything works", () => {
    expect(formatReport([report(), report({ id: "nyaa", label: "Nyaa" })])).toContain(
      "all 2 sources healthy",
    );
  });
});
