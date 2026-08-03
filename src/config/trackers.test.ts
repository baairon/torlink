import { describe, expect, it } from "vitest";
import { formatTrackers, parseTrackers, trackersStatus } from "./trackers";

describe("parseTrackers", () => {
  it("returns empty for blank input", () => {
    expect(parseTrackers("")).toEqual([]);
    expect(parseTrackers("   \n\t  ")).toEqual([]);
  });

  it("splits on commas, whitespace, and newlines", () => {
    const input =
      "udp://a.example:1337/announce, http://b.example/announce\nhttps://c.example/announce\tudp://d.example:80";
    expect(parseTrackers(input)).toEqual([
      "udp://a.example:1337/announce",
      "http://b.example/announce",
      "https://c.example/announce",
      "udp://d.example:80",
    ]);
  });

  it("dedupes exact duplicates", () => {
    const input = "udp://a.example:1337, udp://a.example:1337 udp://a.example:1337";
    expect(parseTrackers(input)).toEqual(["udp://a.example:1337"]);
  });

  it("keeps only udp, http(s), ws(s) schemes", () => {
    const input =
      "udp://a.example:80 http://b.example ftp://c.example file:///etc/passwd hello ws://d.example wss://e.example";
    expect(parseTrackers(input)).toEqual([
      "udp://a.example:80",
      "http://b.example",
      "ws://d.example",
      "wss://e.example",
    ]);
  });

  it("preserves order", () => {
    const input = "https://z.example, https://a.example, https://m.example";
    expect(parseTrackers(input)).toEqual([
      "https://z.example",
      "https://a.example",
      "https://m.example",
    ]);
  });
});

describe("formatTrackers", () => {
  it("joins with a comma and space", () => {
    expect(formatTrackers(["a", "b", "c"])).toBe("a, b, c");
  });

  it("returns empty string for empty array", () => {
    expect(formatTrackers([])).toBe("");
  });
});

describe("trackersStatus", () => {
  it("shows the idle hint when the field matches what is saved", () => {
    expect(trackersStatus(["udp://a.example:1337"], "udp://a.example:1337")).toBe(
      "1 saved · comma or space separated · empty clears",
    );
  });

  it("shows the idle hint without the clear tail when nothing is saved", () => {
    expect(trackersStatus([], "")).toBe("none saved · comma or space separated");
  });

  it("counts what a paste will save", () => {
    expect(
      trackersStatus(["udp://a.example:1337"], "udp://a.example:1337, udp://b.example:80"),
    ).toBe("1 saved → will save 2");
  });

  it("announces that an empty field clears the saved list", () => {
    expect(trackersStatus(["udp://a.example:1337", "udp://b.example:80"], "   ")).toBe(
      "2 saved → empty clears all",
    );
  });

  it("counts invalid tokens as ignored", () => {
    expect(trackersStatus([], "udp://a.example:1337 garbage")).toBe(
      "none saved → will save 1 · 1 ignored",
    );
  });

  it("counts duplicates as ignored", () => {
    expect(trackersStatus([], "udp://a.example:1337, udp://a.example:1337")).toBe(
      "none saved → will save 1 · 1 ignored",
    );
  });

  it("surfaces ignored tokens even when the valid list is unchanged", () => {
    expect(trackersStatus(["udp://a.example:1337"], "udp://a.example:1337 nope")).toBe(
      "1 saved → will save 1 · 1 ignored",
    );
  });
});
