import { describe, it, expect } from "vitest";
import { parseRelease, isVideoFile } from "./parse";
import type { ParsedRelease } from "./types";

describe("parseRelease", () => {
  const cases: Array<[string, Partial<ParsedRelease>]> = [
    [
      "Inception.2010.1080p.BluRay.x264-YIFY",
      {
        title: "inception",
        year: 2010,
        resolution: "1080p",
        source: "bluray",
        codec: "x264",
        group: "yify",
      },
    ],
    [
      "Severance.S02E01.1080p.WEB.H264-NTb.mkv",
      {
        title: "severance",
        season: 2,
        episode: 1,
        resolution: "1080p",
        source: "web",
        codec: "h264",
        group: "ntb",
      },
    ],
    ["Show 1x02 720p HDTV", { title: "show", season: 1, episode: 2, resolution: "720p", source: "hdtv" }],
    ["The Prestige (2006) 720p BRRip x265", { title: "the prestige", year: 2006, source: "bluray", codec: "x265" }],
    ["Some_Movie_2019_WEB-DL_H.265-GRP.mp4", { title: "some movie", year: 2019, source: "web", codec: "h265", group: "grp" }],
    ["Plain.Title.S01E05.WEBRip", { title: "plain title", season: 1, episode: 5, source: "web" }],
    // A year-shaped token at position 0 is the title, not the release year.
    ["1917.2019.1080p.BluRay", { title: "1917", year: 2019, resolution: "1080p", source: "bluray" }],
    ["2012.2009.720p", { title: "2012", year: 2009, resolution: "720p" }],
  ];

  for (const [name, want] of cases) {
    it(`parses ${name}`, () => {
      expect(parseRelease(name)).toMatchObject(want);
    });
  }

  it("strips video/subtitle extensions before parsing", () => {
    expect(parseRelease("Movie.2020.720p.srt").title).toBe("movie");
    expect(parseRelease("Movie.2020.720p.avi").resolution).toBe("720p");
  });

  it("has no year/season for a bare title", () => {
    const p = parseRelease("Just_A_Title");
    expect(p.title).toBe("just a title");
    expect(p.year).toBeUndefined();
    expect(p.season).toBeUndefined();
  });
});

describe("isVideoFile", () => {
  it("accepts video extensions, rejects others", () => {
    expect(isVideoFile("a/b/movie.MKV")).toBe(true);
    expect(isVideoFile("movie.mp4")).toBe(true);
    expect(isVideoFile("movie.srt")).toBe(false);
    expect(isVideoFile("movie.txt")).toBe(false);
    expect(isVideoFile("movie")).toBe(false);
  });
});

// Season-only pack names: a torrent named for the whole season carries S01 or
// "Season 1" with no episode; the per-file parse supplies episodes later.
describe("parseRelease season-only forms", () => {
  it("parses bare S01 as season without episode", () => {
    const p = parseRelease("Severance.S01.1080p.WEB.h264");
    expect(p.title).toBe("severance");
    expect(p.season).toBe(1);
    expect(p.episode).toBeUndefined();
    expect(p.resolution).toBe("1080p");
  });
  it("parses 'Season 2' word form", () => {
    const p = parseRelease("The.Bear.Season.2.Complete.720p.WEB");
    expect(p.title).toBe("the bear");
    expect(p.season).toBe(2);
    expect(p.episode).toBeUndefined();
  });
});

// Modern streaming-service tags all mean a web rip; bare "max" is deliberately
// NOT a source tag — it collides with titles (Mad Max) and would truncate them.
describe("parseRelease streaming-service source tags", () => {
  it.each([
    ["The.Bear.S02E01.1080p.DSNP.x264", "web"],
    ["Show.S01E01.720p.HULU.h264", "web"],
    ["Series.S03E02.2160p.ATVP.x265", "web"],
    ["Movie.2023.1080p.HMAX.x264", "web"],
    ["Show.S01E05.1080p.PCOK.h264", "web"],
  ])("%s → source %s", (name, source) => {
    expect(parseRelease(name).source).toBe(source);
  });
  it("keeps 'max' as title text, not a source marker", () => {
    const p = parseRelease("Mad.Max.Fury.Road.2015.1080p.BluRay.x264");
    expect(p.title).toBe("mad max fury road");
    expect(p.year).toBe(2015);
  });
});
