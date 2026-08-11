import { describe, it, expect } from "vitest";
import {
  formatBytes,
  parseRate,
  parseRates,
  formatRates,
  parseSize,
  formatBytesPerSec,
  formatCount,
  formatRelative,
  formatEtaShort,
  cleanText,
  stripControl,
  truncate,
} from "./format";

describe("formatBytes", () => {
  it("formats across units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(933)).toBe("933 B");
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(2.1e9)).toBe("1.96 GB");
    expect(formatBytes(undefined)).toBe("0 B");
  });
});

describe("parseSize", () => {
  it("parses human sizes to bytes", () => {
    expect(parseSize("1.4 GiB")).toBe(Math.round(1.4 * 1024 ** 3));
    expect(parseSize("700 MB")).toBe(700_000_000);
    expect(parseSize("350.2 MiB")).toBe(Math.round(350.2 * 1024 ** 2));
    expect(parseSize("nothing here")).toBe(0);
  });
});

describe("formatBytesPerSec", () => {
  it("formats rates and blanks zero", () => {
    expect(formatBytesPerSec(0)).toBe("");
    expect(formatBytesPerSec(5.2e6)).toMatch(/MB\/s$/);
  });
});

describe("formatCount", () => {
  it("passes small counts through untouched", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(742)).toBe("742");
    expect(formatCount(9999)).toBe("9999");
  });

  it("compacts large counts to k/m", () => {
    expect(formatCount(11500)).toBe("12k");
    expect(formatCount(10639)).toBe("11k");
    expect(formatCount(999_400)).toBe("999k");
    expect(formatCount(999_600)).toBe("1m");
    expect(formatCount(1_500_000)).toBe("1.5m");
    expect(formatCount(12_000_000)).toBe("12m");
  });

  it("never exceeds 4 characters so seed:leech fits its column", () => {
    for (const n of [9999, 10_000, 99_499, 999_499, 999_999, 9_949_999, 999_000_000]) {
      expect(formatCount(n).length).toBeLessThanOrEqual(4);
    }
  });
});

describe("formatRelative", () => {
  it("describes recent times", () => {
    const now = Date.now() / 1000;
    expect(formatRelative(now - 30)).toBe("now");
    expect(formatRelative(now - 125)).toBe("2m ago");
    expect(formatRelative(0)).toBe("");
  });
});

describe("formatEtaShort", () => {
  it("formats remaining time compactly", () => {
    expect(formatEtaShort(45)).toBe("45s");
    expect(formatEtaShort(125)).toBe("2m 5s");
    expect(formatEtaShort(3725)).toBe("1hr 2m");
    expect(formatEtaShort(90061)).toBe("1d 1hr 1m");
    expect(formatEtaShort(undefined)).toBe("");
  });
});

describe("cleanText", () => {
  it("strips junk glyphs and collapses whitespace", () => {
    expect(cleanText("Foo 🎬 Bar")).toBe("Foo Bar");
    expect(cleanText("🎬🎬")).toBe("Untitled");
  });
});

describe("truncate", () => {
  it("truncates with an ellipsis", () => {
    expect(truncate("hello world", 5)).toBe("hell…");
    expect(truncate("hi", 5)).toBe("hi");
  });
});

describe("stripControl", () => {
  const ESC = String.fromCharCode(0x1b);
  const BEL = String.fromCharCode(0x07);
  const hash = "0123456789abcdef0123456789abcdef01234567";

  it("removes an OSC-52 clipboard-write smuggled into a magnet", () => {
    const magnet = `magnet:?xt=urn:btih:${hash}${ESC}]52;c;ZXZpbA==${BEL}`;
    expect(stripControl(magnet)).toBe(`magnet:?xt=urn:btih:${hash}]52;c;ZXZpbA==`);
  });

  it("removes CSI colour/cursor escapes", () => {
    expect(stripControl(`${ESC}[31mred${ESC}[0m`)).toBe("[31mred[0m");
  });

  it("removes DEL and C1 controls (8-bit CSI/OSC/ST forms)", () => {
    const c1 = `x${String.fromCharCode(0x9b)}y${String.fromCharCode(0x9c)}z${String.fromCharCode(0x7f)}`;
    expect(stripControl(c1)).toBe("xyz");
  });

  it("preserves ordinary characters exactly, without cleanText's folding", () => {
    expect(stripControl(hash)).toBe(hash);
    expect(stripControl("a  b")).toBe("a  b");
    expect(stripControl("")).toBe("");
  });
});

describe("parseRate", () => {
  it("reads a bare number as MB/s — the unit anyone capping a line thinks in", () => {
    expect(parseRate("5")).toBe(5 * 1024 ** 2);
    expect(parseRate("0.5")).toBe(0.5 * 1024 ** 2);
  });

  it("round-trips what formatBytesPerSec prints", () => {
    for (const bytes of [256 * 1024, 1024 ** 2, 12 * 1024 ** 2]) {
      expect(parseRate(formatBytesPerSec(bytes))).toBe(bytes);
    }
  });

  it("takes the unit with or without the /s and the space", () => {
    const half = 512 * 1024;
    expect(parseRate("512KB")).toBe(half);
    expect(parseRate("512 KB/s")).toBe(half);
    expect(parseRate("512 kb / s")).toBe(half);
    expect(parseRate("512 KiB/sec")).toBe(half);
  });

  it("uses powers of 1024, unlike parseSize's decimal KB", () => {
    expect(parseRate("1 KB")).toBe(1024);
    expect(parseSize("1 KB")).toBe(1000);
  });

  it("reads a comma as a decimal separator", () => {
    expect(parseRate("1,5 MB/s")).toBe(1.5 * 1024 ** 2);
  });

  it("returns 0 for empty input — the field's emptiness clears the cap", () => {
    expect(parseRate("")).toBe(0);
    expect(parseRate("   ")).toBe(0);
    expect(parseRate("0")).toBe(0);
  });

  it("returns null for anything unreadable, so a caller can tell it apart from 0", () => {
    expect(parseRate("fast")).toBeNull();
    expect(parseRate("-5")).toBeNull();
    expect(parseRate("5 TB/s")).toBeNull();
    expect(parseRate("5 MB/s please")).toBeNull();
  });
});

describe("parseRates", () => {
  it("takes both directions, download first", () => {
    expect(parseRates("5 MB/s, 1 MB/s")).toEqual({
      down: 5 * 1024 ** 2,
      up: 1024 ** 2,
    });
  });

  it("leaves upload unlimited when only one side is given", () => {
    expect(parseRates("5 MB/s")).toEqual({ down: 5 * 1024 ** 2, up: 0 });
  });

  it("clears both on an empty field", () => {
    expect(parseRates("")).toEqual({ down: 0, up: 0 });
  });

  it("caps upload alone when the download side is 0", () => {
    expect(parseRates("0, 1 MB/s")).toEqual({ down: 0, up: 1024 ** 2 });
  });

  it("rejects the whole input when either side is unreadable", () => {
    expect(parseRates("5 MB/s, fast")).toBeNull();
    expect(parseRates("fast, 1 MB/s")).toBeNull();
    expect(parseRates("1, 2, 3")).toBeNull();
  });

  it("round-trips through formatRates", () => {
    const pairs = [
      { down: 0, up: 0 },
      { down: 5 * 1024 ** 2, up: 0 },
      { down: 0, up: 1024 ** 2 },
      { down: 256 * 1024, up: 512 * 1024 },
    ];
    for (const pair of pairs) {
      expect(parseRates(formatRates(pair.down, pair.up))).toEqual(pair);
    }
  });
});
