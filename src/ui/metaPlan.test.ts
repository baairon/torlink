import { describe, expect, it } from "vitest";
import { NO_META_PLAN, planMetaRows } from "./metaPlan";
import { displayWidth } from "./textWidth";
import type { Meta } from "../meta/types";

// The detail panel's row-budget arithmetic without a render: Results.test.tsx proves the panel
// draws what it is given, and these prove what it is given. A wrapped credit that costs two rows
// instead of one is a fused row in the panel, which is the hardest failure to read off a rendered
// snapshot.
const META: Meta = {
  imdbId: "tt0111161",
  kind: "movie",
  title: "The Shawshank Redemption",
  year: "1994",
  rating: "9.3",
  runtime: "142 min",
  genres: ["Drama"],
  cast: ["Neo"],
  director: ["Frank Darabont"],
  plot: "A banker convicted of murdering his wife forms a friendship over a number of years.",
};

const WIDTH = 30;
const INFINITE = Number.POSITIVE_INFINITY;

describe("planMetaRows", () => {
  it("answers every field null when there is no metadata to plan", () => {
    expect(planMetaRows(null, WIDTH, INFINITE)).toEqual(NO_META_PLAN);
  });

  it("builds every row when nothing is competing for rows", () => {
    const plan = planMetaRows(META, WIDTH, INFINITE);
    expect(plan.rating).toBe("9.3 / 10");
    expect(plan.genres).toBe("Drama");
    expect(plan.director).toBe("Frank Darabont");
    expect(plan.cast).toBe("Neo");
    // Wrapped to this width, so compare against the wrap-normalized text rather than the raw
    // single-line source.
    expect(plan.plot?.replace(/\n/g, " ")).toBe(META.plot);
  });

  it("answers an empty plan for a budget with no rows to give", () => {
    expect(planMetaRows(META, WIDTH, 0)).toEqual(NO_META_PLAN);
    expect(planMetaRows(META, WIDTH, -3)).toEqual(NO_META_PLAN);
  });

  it("spends the budget in priority order — rating, then genres, then director, then cast", () => {
    // Each of these four rows costs exactly one line at this fixture and width.
    expect(planMetaRows(META, WIDTH, 1)).toMatchObject({
      rating: "9.3 / 10",
      genres: null,
      director: null,
      cast: null,
    });
    expect(planMetaRows(META, WIDTH, 2)).toMatchObject({
      rating: "9.3 / 10",
      genres: "Drama",
      director: null,
      cast: null,
    });
    expect(planMetaRows(META, WIDTH, 3)).toMatchObject({
      rating: "9.3 / 10",
      genres: "Drama",
      director: "Frank Darabont",
      cast: null,
    });
  });

  it("treats a field the result never carried as absent, not as a fit failure", () => {
    const noRating: Meta = { ...META, rating: undefined };
    const plan = planMetaRows(noRating, WIDTH, 3);
    // Genres, director and cast all fit in the three rows a missing rating never claimed.
    expect(plan).toMatchObject({ rating: null, genres: "Drama", director: "Frank Darabont", cast: "Neo" });
  });

  it("holds the cutoff once a present row does not fit, even for a shorter row right after it", () => {
    // Two directors wrap to two lines at this width; the cast credit right after it would fit
    // in the one row left over on its own, but the cutoff a two-row overflow triggers drops it
    // too rather than leaving a hole where director should have been.
    const wideDirector: Meta = { ...META, director: ["Christopher Alexander Nolan", "Peter Jackson"] };
    const plan = planMetaRows(wideDirector, WIDTH, 3);
    expect(plan.rating).toBe("9.3 / 10");
    expect(plan.genres).toBe("Drama");
    expect(plan.director).toBeNull();
    expect(plan.cast).toBeNull();
  });

  it("still gives the plot the row a dropped credit left unclaimed", () => {
    // Same fixture as the cutoff test above: director's failed attempt never spent the one row
    // left after rating and genres, so plot — exempt from the cutoff — gets to spend it.
    const wideDirector: Meta = { ...META, director: ["Christopher Alexander Nolan", "Peter Jackson"] };
    const plan = planMetaRows(wideDirector, WIDTH, 3);
    expect(plan.plot).not.toBeNull();
    expect(displayWidth(plan.plot ?? "")).toBeLessThanOrEqual(WIDTH);
  });

  it("omits the plot row entirely when the rows above it spent everything", () => {
    expect(planMetaRows(META, WIDTH, 4).plot).toBeNull();
  });

  it("ellipsizes the plot's last line rather than dropping it whole", () => {
    const longPlot: Meta = {
      ...META,
      plot:
        "A computer hacker learns from mysterious rebels about the true nature of his reality and " +
        "his role in the war against its controllers, who farm humanity in a simulated world.",
    };
    const plan = planMetaRows(longPlot, WIDTH, 6);
    expect(plan.plot).toContain("…");
    for (const line of plan.plot?.split("\n") ?? []) {
      expect(displayWidth(line)).toBeLessThanOrEqual(WIDTH);
    }
  });

  it("never spends more rows than it was given", () => {
    const rowsOf = (plan: ReturnType<typeof planMetaRows>): number =>
      [plan.rating, plan.genres, plan.director, plan.cast, plan.plot]
        .filter((v): v is string => v !== null)
        .reduce((n, v) => n + v.split("\n").length, 0);
    for (let budget = 0; budget <= 8; budget++) {
      expect(rowsOf(planMetaRows(META, WIDTH, budget)), `budget ${budget}`).toBeLessThanOrEqual(budget);
    }
  });
});
