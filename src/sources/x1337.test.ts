import { describe, it, expect } from "vitest";
import { parseUploadDate, x1337Movies, x1337Music, x1337Tv } from "./x1337";

const detail = (span: string) =>
  `<ul class="list"><li><strong>Date uploaded</strong><span>${span}</span> </li></ul>`;

describe("parseUploadDate", () => {
  it("parses the 'Mon. Dayth \\'YY' format to a UTC unix timestamp", () => {
    const ts = parseUploadDate(detail("Jun. 26th  '26"));
    expect(ts).toBe(Math.floor(Date.UTC(2026, 5, 26) / 1000));
  });

  it("handles single-digit days and other ordinals", () => {
    expect(parseUploadDate(detail("Jan. 1st '24"))).toBe(Math.floor(Date.UTC(2024, 0, 1) / 1000));
    expect(parseUploadDate(detail("Mar. 3rd '25"))).toBe(Math.floor(Date.UTC(2025, 2, 3) / 1000));
    expect(parseUploadDate(detail("Dec. 22nd '23"))).toBe(Math.floor(Date.UTC(2023, 11, 22) / 1000));
  });

  it("returns undefined when the field is missing or unparseable", () => {
    expect(parseUploadDate("<div>no date here</div>")).toBeUndefined();
    expect(parseUploadDate(detail("sometime"))).toBeUndefined();
  });
});

describe("1337x category variants", () => {
  it("gives each tab its own source id while sharing the site", () => {
    expect([x1337Movies.id, x1337Tv.id, x1337Music.id]).toEqual([
      "x1337-movies",
      "x1337-tv",
      "x1337-music",
    ]);
    expect(x1337Music.groups).toEqual(["Music"]);
    // One site, one label: the tag answers who found a row, not what kind.
    expect(new Set([x1337Movies.label, x1337Tv.label, x1337Music.label])).toEqual(
      new Set(["1337x"]),
    );
  });
});
