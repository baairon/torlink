import { describe, expect, it } from "vitest";
import { planPaneLines } from "./paneCard";
import { displayWidth } from "./textWidth";
import { ICON } from "./theme";
import type { Meta } from "../meta/types";

// The card's row arithmetic without a render: MetaPane.test.tsx proves the pane draws what it is
// given, and these prove what it is given. A wrapped credit that costs three rows instead of two
// is a fused row in the frame, which is the hardest failure to read off a rendered snapshot.
const META: Meta = {
  imdbId: "tt0133093",
  kind: "movie",
  title: "The Matrix",
  year: "1999",
  rating: "8.7",
  runtime: "136 min",
  genres: ["Action", "Sci-Fi"],
  cast: ["Keanu Reeves", "Laurence Fishburne", "Carrie-Anne Moss", "Hugo Weaving"],
  director: ["Lana Wachowski", "Lilly Wachowski"],
};

// Kept separate from META so every assertion above about the facts card still measures the facts
// card. Length is roughly what Cinemeta sends after the client's 800-column cap.
const WITH_PLOT: Meta = {
  ...META,
  plot:
    "A computer hacker learns from mysterious rebels about the true nature of his reality and " +
    "his role in the war against its controllers, who farm humanity in a simulated world while " +
    "harvesting the sleeping bodies for power in cell after cell.",
};

const WIDTH = 30;
const INFINITE = Number.POSITIVE_INFINITY;

const keys = (meta: Meta, width: number, budget: number): string[] =>
  planPaneLines(meta, width, budget).map((l) => l.key);

/** One entry per terminal row, the way MetaPane flattens the card before windowing it. */
const rows = (meta: Meta, width: number, budget: number): string[] =>
  planPaneLines(meta, width, budget).flatMap((l) => l.text.split("\n"));

describe("planPaneLines", () => {
  it("builds the whole card when nothing is competing for rows", () => {
    // The focused pane's budget: it scrolls, so the window below decides what shows and the
    // planner's only job is to lay out every line the row has.
    expect(keys(META, WIDTH, INFINITE)).toEqual(["title", "facts", "genres", "director", "cast"]);
    const text = rows(META, WIDTH, INFINITE);
    expect(text[0]).toBe("The Matrix");
    expect(text[1]).toBe(`1999 ${ICON.dot} 8.7 ${ICON.dot} 136 min`);
    for (const line of text) expect(displayWidth(line)).toBeLessThanOrEqual(WIDTH);
  });

  it("spends a one-row pane on the title rather than dropping it", () => {
    // The title is the line that says *which* work this is; a card with no room for it says
    // nothing at all.
    const lines = planPaneLines(META, WIDTH, 1);
    expect(lines.map((l) => l.key)).toEqual(["title"]);
    expect(lines[0]?.tone).toBe("title");
  });

  it("forces the ellipsis onto a capped title, which otherwise reads as the whole one", () => {
    // A wrapped line fills its width exactly, so the cut is invisible without it.
    const long = { ...META, title: "The Lord of the Rings: The Fellowship of the Ring" };
    const lines = planPaneLines(long, 20, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toContain("…");
    expect(displayWidth(lines[0]?.text ?? "")).toBeLessThanOrEqual(20);
  });

  it("cuts the card once at the bottom rather than leaving a hole in the middle", () => {
    // 5 rows: title, facts, genres and the two the director credit wraps to. The cast credit
    // wraps to three at this width and there is nothing left to spend on it.
    expect(keys(META, WIDTH, 5)).toEqual(["title", "facts", "genres", "director"]);
    expect(rows(META, WIDTH, 5)).toHaveLength(5);
  });

  it("holds the cutoff once something has been cut, even for a line that would have fitted", () => {
    // The alternative is a hole in the middle of the card: a two-row director credit dropped and
    // the one-row cast credit under it kept, which reads as a pane that lost a field rather than
    // as one that ran out of room.
    const short = { ...META, cast: ["Neo"] };
    expect(keys(short, WIDTH, INFINITE)).toContain("cast");
    expect(keys(short, WIDTH, 4)).toEqual(["title", "facts", "genres"]);
  });

  it("never spends more rows than it was given", () => {
    for (let budget = 0; budget <= 12; budget++) {
      expect(rows(META, WIDTH, budget).length, `budget ${budget}`).toBeLessThanOrEqual(budget);
    }
  });

  it("treats a field the provider never sent as absent, not as a fit failure", () => {
    // Cinemeta sends no director for most series and no runtime for plenty of titles. An empty
    // field costs nothing and must not end the card the way an overlong one does.
    const series: Meta = {
      ...META,
      kind: "series",
      runtime: undefined,
      director: [],
      episode: { season: 3, number: 7, title: "Winter Is Coming" },
    };
    expect(keys(series, WIDTH, INFINITE)).toEqual(["title", "facts", "episode", "genres", "cast"]);
    // The cast still lands with the director's rows never having been claimed by anything.
    expect(keys(series, WIDTH, 7)).toContain("cast");
  });

  it("answers an empty card for a pane with no rows to give", () => {
    expect(planPaneLines(META, WIDTH, 0)).toEqual([]);
    expect(planPaneLines(META, WIDTH, -3)).toEqual([]);
  });

  it("leaves a card with no plot exactly as it was", () => {
    expect(keys(META, WIDTH, INFINITE)).not.toContain("plot");
    expect(keys({ ...META, plot: "" }, WIDTH, INFINITE)).toEqual(keys(META, WIDTH, INFINITE));
  });

  it("gives the focused pane every line of the plot, none of them cut", () => {
    const lines = planPaneLines(WITH_PLOT, WIDTH, INFINITE);
    expect(lines.at(-1)?.key).toBe("plot");
    const plot = lines.at(-1)?.text.split("\n") ?? [];
    expect(plot.length).toBeGreaterThan(3);
    for (const line of plot) {
      expect(displayWidth(line)).toBeLessThanOrEqual(WIDTH);
      expect(line).not.toContain("…");
    }
    expect(plot.join(" ")).toContain("cell");
  });

  it("spends the leftovers on the plot even when the cutoff dropped the credits", () => {
    // The plot is the one field with no natural length, so it is the one that fills a gap rather
    // than being refused whole: a card that lost its cast credit to a two-row overflow still has
    // that row to say what the film is about.
    const lines = planPaneLines(WITH_PLOT, WIDTH, 4);
    expect(lines.map((l) => l.key)).toEqual(["title", "facts", "genres", "plot"]);
    expect(rows(WITH_PLOT, WIDTH, 4)).toHaveLength(4);
  });

  it("forces the ellipsis onto the last kept plot line, which fills its width exactly", () => {
    const plot = planPaneLines(WITH_PLOT, WIDTH, 6).find((l) => l.key === "plot");
    const kept = plot?.text.split("\n") ?? [];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.at(-1)).toContain("…");
    for (const line of kept) expect(displayWidth(line)).toBeLessThanOrEqual(WIDTH);
  });

  it("omits the plot row entirely when the facts spent everything", () => {
    // No row at all rather than an empty one: a blank line at the bottom of the pane reads as a
    // field that failed to load.
    expect(keys(WITH_PLOT, WIDTH, 3)).toEqual(["title", "facts", "genres"]);
  });

  it("wraps a CJK plot by display column, not by string length", () => {
    // Cinemeta returns CJK synopses for the anime titles nyaa and subsplease index, and each of
    // those characters is one string unit but two terminal columns — the miscount that fused rows
    // in the detail panel before wordWrapLines measured width instead of length.
    const cjk = {
      ...META,
      plot: "本作は刑務所を舞台にした友情と希望の物語である。".repeat(8),
    };
    const plot = planPaneLines(cjk, WIDTH, INFINITE).find((l) => l.key === "plot");
    for (const line of plot?.text.split("\n") ?? []) {
      expect(displayWidth(line)).toBeLessThanOrEqual(WIDTH);
    }
  });

  it("wraps an astral-plane emoji plot without splitting a surrogate pair", () => {
    const emoji = { ...META, plot: "🎬 A film 🍿 about 👨‍👩‍👧 a family ".repeat(6) };
    const plot = planPaneLines(emoji, WIDTH, INFINITE).find((l) => l.key === "plot");
    const lines = plot?.text.split("\n") ?? [];
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(WIDTH);
      // A pair cut down the middle surfaces as the replacement character, not as an exception.
      expect(line).not.toContain("�");
    }
  });

  it("keeps only the first four cast names, tagged so the two name lists are told apart", () => {
    const crowded = { ...META, cast: ["A Aa", "B Bb", "C Cc", "D Dd", "E Ee", "F Ff"] };
    const cast = planPaneLines(crowded, WIDTH, INFINITE).find((l) => l.key === "cast");
    expect(cast?.text).toBe("Cast A Aa, B Bb, C Cc, D Dd");
    expect(planPaneLines(crowded, WIDTH, INFINITE).find((l) => l.key === "director")?.text).toBe(
      "Dir Lana Wachowski, Lilly\nWachowski",
    );
  });
});
