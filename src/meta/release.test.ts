import { describe, it, expect } from "vitest";
import {
  parseRelease,
  normalizeSeparators,
  findEpisodeMarker,
  findYear,
  firstJunkIndex,
} from "./release";
import type { ParsedRelease } from "./release";

type Row = readonly [name: string, expected: Partial<ParsedRelease>];

// Every row below the first three is a real name sampled from a live source adapter.
const TABLE: readonly Row[] = [
  [
    "The.Matrix.1999.1080p.BluRay.x264-GROUP",
    { title: "The Matrix", year: 1999, kind: "movie", group: "GROUP" },
  ],
  ["Show.S01E05.720p.WEB", { title: "Show", season: 1, episode: 5, kind: "series" }],
  [
    "[SubsPlease] Show - 01 (1080p) [ABCD1234].mkv",
    { title: "Show", episode: 1, kind: "series", group: "SubsPlease" },
  ],
  ["The.Odyssey.2026.1080p.TELESYNC.HEVC.AAC2.0-SPLiCE", { title: "The Odyssey", year: 2026 }],
  ["Disclosure Day (2026) [1080p] [WEBRip] [5.1]", { title: "Disclosure Day", year: 2026 }],
  [
    "Marvel Studios Iron Man 2008 1080p MA WEB-DL DDP5 1 H 264-SARVO",
    { title: "Marvel Studios Iron Man", year: 2008 },
  ],
  [
    "Rick and Morty S09E10 Field of Dreams 1080p AMZN WEB-DL DDP5 1 H 264-FLUX",
    { title: "Rick and Morty", season: 9, episode: 10 },
  ],
  [
    "House of the Dragon S03E07 1080p WEB H264-CAKES",
    { title: "House of the Dragon", season: 3, episode: 7 },
  ],
  [
    "Spider-Man: Brand New Day 2026.1080p.HQ Pre.Multi.AAC 2.0.x264",
    { title: "Spider-Man: Brand New Day", year: 2026 },
  ],
  [
    "Avatar.The.Legend.of.Aang.The.Last.Airbender.2026.1080p.PMNTP.WEBRip.AAC2.0.H264-[LEAK].mp4",
    { title: "Avatar The Legend of Aang The Last Airbender", year: 2026 },
  ],
  ["Oppenheimer (2023) [1080p bluray]", { title: "Oppenheimer", year: 2023 }],
  ["Breaking Bad S05E14 1080p WEB-DL", { title: "Breaking Bad", season: 5, episode: 14 }],
  ["Frieren - 28 [1080p]", { title: "Frieren", episode: 28, kind: "series" }],
  [
    "Tensei Shitara Slime Datta Ken S4 - 17 [1080p]",
    { title: "Tensei Shitara Slime Datta Ken", season: 4, episode: 17 },
  ],
  ["Hell Mode S2 - 06v2 [1080p]", { title: "Hell Mode", season: 2, episode: 6 }],
  [
    "[Erai-raws] Jujutsu Kaisen S2 - 23 [1080p]",
    { title: "Jujutsu Kaisen", season: 2, episode: 23, group: "Erai-raws" },
  ],
  ["[WZF]Bleach_-_100[X264-AAC][784x576][Sub_Esp][MP4]", { title: "Bleach", episode: 100 }],
  [
    "Zillow Gone Wild S03E14 Enchanted Forest 480p WEB-DL x264-RMTeam EZTV",
    { title: "Zillow Gone Wild", season: 3, episode: 14 },
  ],
  [
    "Elden Ring: Shadow of the Erdtree Edition",
    { title: "Elden Ring: Shadow of the Erdtree Edition", kind: "movie" },
  ],
];

describe("parseRelease", () => {
  for (const [name, expected] of TABLE) {
    it(`parses ${name}`, () => {
      expect(parseRelease(name)).toMatchObject(expected);
    });
  }

  // A bare hyphenated title has the same shape as a scene "-GROUP" suffix. Trackers really do
  // post names this minimal, and mistaking "Man" for a group would send "Spider" to the lookup.
  // ("Mad-Max" is deliberately not in this list: "max" is source vocabulary, so it would pass on
  // the junk guard alone and prove nothing about the corroboration rule.)
  for (const bare of ["Spider-Man", "Ant-Man", "X-Men", "Kill-Bill"]) {
    it(`keeps the hyphenated title ${bare} intact and extracts no group`, () => {
      const parsed = parseRelease(bare);
      expect(parsed.title).toBe(bare);
      expect(parsed.group).toBeUndefined();
    });
  }

  it("still takes a trailing group when scene context corroborates it", () => {
    expect(parseRelease("Ant-Man.2015.1080p.BluRay.x264-GROUP")).toMatchObject({
      title: "Ant-Man",
      year: 2015,
      group: "GROUP",
    });
  });

  it("survives full-width brackets and CJK without throwing", () => {
    const parsed = parseRelease("【喵萌奶茶屋】★07月新番★[花織同學][04][1080p][繁體]");
    expect(typeof parsed.title).toBe("string");
  });

  it("parses a bare parenthesised year", () => {
    expect(parseRelease("Old School (2003)")).toMatchObject({ title: "Old School", year: 2003 });
  });

  for (const degenerate of ["", ".", "[]", "2012"]) {
    it(`returns a string title for the degenerate input ${JSON.stringify(degenerate)}`, () => {
      const parsed = parseRelease(degenerate);
      expect(typeof parsed.title).toBe("string");
      expect(parsed.title === "" || degenerate.includes(parsed.title)).toBe(true);
    });
  }

  it("never throws and always yields a string title over a junk corpus", () => {
    const alphabet = ["", ".", "-", "_", "[", "]", "(", ")", "S01E01", "1080p", "2020", "x", "喵"];
    for (let i = 0; i < 3000; i++) {
      let name = "";
      // Deterministic pseudo-random walk: a seeded corpus keeps failures reproducible.
      let seed = i * 2654435761;
      for (let j = 0; j < 8; j++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        name += alphabet[seed % alphabet.length];
      }
      const parsed = parseRelease(name);
      expect(typeof parsed.title).toBe("string");
      expect(parsed.kind === "movie" || parsed.kind === "series").toBe(true);
    }
  });
});

describe("normalizeSeparators", () => {
  it("always turns underscores into spaces", () => {
    expect(normalizeSeparators("Some_Show_Name")).toBe("Some Show Name");
  });

  it("turns dots into spaces when dots outnumber spaces", () => {
    expect(normalizeSeparators("The.Matrix.1999.1080p")).toBe("The Matrix 1999 1080p");
  });

  it("keeps dots when spaces already dominate, so decimals survive", () => {
    expect(normalizeSeparators("Some Long Show Name AAC 2.0")).toBe("Some Long Show Name AAC 2.0");
  });
});

describe("findEpisodeMarker", () => {
  it("finds SxxExx", () => {
    expect(findEpisodeMarker("Breaking Bad S05E14 1080p")).toMatchObject({ season: 5, episode: 14 });
  });

  it("finds the 1x02 form", () => {
    expect(findEpisodeMarker("Some Show 3x07 720p")).toMatchObject({ season: 3, episode: 7 });
  });

  it("finds a bare season", () => {
    expect(findEpisodeMarker("Hell Mode S2")).toMatchObject({ season: 2 });
  });

  it("returns null when there is no marker at all", () => {
    expect(findEpisodeMarker("The Matrix 1999 1080p BluRay")).toBeNull();
  });
});

describe("findYear", () => {
  it("prefers a parenthesised year", () => {
    expect(findYear("Old School (2003)")).toMatchObject({ year: 2003 });
  });

  it("takes a standalone year followed by junk", () => {
    expect(findYear("The Matrix 1999 1080p BluRay")).toMatchObject({ year: 1999 });
  });

  it("refuses a year that is the only remaining token", () => {
    expect(findYear("2012")).toBeNull();
  });
});

describe("firstJunkIndex", () => {
  it("reports the first junk token position", () => {
    expect(firstJunkIndex(["The", "Matrix", "1080p", "BluRay"])).toBe(2);
  });

  it("reports -1 when nothing is junk", () => {
    expect(firstJunkIndex(["Elden", "Ring"])).toBe(-1);
  });
});
