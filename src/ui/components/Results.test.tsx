import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOURCES } from "../../sources/registry";
import { StoreContext, type Store } from "../store";
import {
  KEY,
  makeTestStore,
  renderUI,
  TEST_COLS,
  TEST_CONTENT_WIDTH,
  type RenderedUI,
} from "../testHarness";
import { Results } from "./Results";
import { RAIL_WIDTH } from "./Sidebar";
import { resultsPanelOuter } from "../move";
import { previewLayout } from "../previewLayout";
import { displayWidth } from "../textWidth";
import { ICON } from "../theme";
import type { ConcurrentSearchState } from "../hooks/useConcurrentSearch";
import type { MetaState } from "../hooks/useResultMeta";
import type { Meta } from "../../meta/types";
import type { TorrentResult } from "../../sources/types";

const searchState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../hooks/useConcurrentSearch", () => ({
  useConcurrentSearch: () => searchState.current,
}));

const IDLE_META: MetaState = { loading: false, meta: null };
const metaState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../hooks/useResultMeta", () => ({
  useResultMeta: () => metaState.current,
}));

// Off for every test above — none of their fixtures carries a posterUrl, so the real hook would
// answer null anyway — and switched on by the frame sweep at the bottom, which needs art in the
// pane without a byte going over the wire.
const posterOn = vi.hoisted(() => ({ current: false }));

vi.mock("../hooks/usePoster", () => ({
  usePoster: (_url: string | undefined, cols: number, rows: number, enabled: boolean) => {
    if (!posterOn.current || !enabled || cols < 1 || rows < 1) return { loading: false, cells: null };
    // What fitCells answers for a 2:3 poster in this budget: width-first, capped by the rows.
    const r = Math.min(rows, Math.max(1, Math.round(cols * 0.75)));
    return {
      loading: false,
      cells: {
        cols,
        rows: r,
        lines: Array.from({ length: r }, () => [{ fg: "#ff0000", bg: "#0000ff", n: cols }]),
      },
    };
  },
}));

const t = (infoHash: string, name: string): TorrentResult => ({
  infoHash,
  name,
  source: "yts",
  sizeBytes: 2.1e9,
  seeders: 40,
  leechers: 6,
  magnet: `magnet:?xt=urn:btih:${infoHash}`,
  added: 1_760_000_000,
});

// Invented names. "ubuntu 24" exercises all three rank tiers: exact substring
// (a1), tokens in order (b2), tokens scattered (c3).
const LIST = [
  t("a1", "ubuntu 24.04 desktop amd64 iso"),
  t("b2", "ubuntu server 24.04 arm64 iso"),
  t("c3", "24 hour timelapse of ubuntu builds"),
  t("d4", "debian 12 netinst iso"),
  t("e5", "arch linux 2026.07 iso"),
  t("f6", "fedora workstation 42 iso"),
  t("g7", "gentoo stage3 tarball"),
  t("h8", "mint cinnamon 22 iso"),
];

function settled(results: TorrentResult[]): ConcurrentSearchState {
  const perSource = Object.fromEntries(
    SOURCES.map((s) => [s.id, { loading: false, error: null, code: null, count: 0 }]),
  ) as ConcurrentSearchState["perSource"];
  return { results, perSource, loading: false, done: SOURCES.length, total: SOURCES.length };
}

let ui: RenderedUI | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

// App.tsx's own width math, so a test asking for a wider terminal gets the content width the real
// app would hand Results at that size rather than a hand-copied number that can drift from it.
const contentWidthFor = (cols: number): number => Math.max(24, cols - RAIL_WIDTH - 3);

async function mount(
  results: TorrentResult[] = LIST,
  storeOverrides: Partial<Store> = {},
  meta: MetaState = IDLE_META,
  cols: number = TEST_COLS,
): Promise<RenderedUI> {
  searchState.current = settled(results);
  metaState.current = meta;
  ui = renderUI(
    <StoreContext.Provider
      value={makeTestStore({
        query: "linux iso",
        cols,
        contentWidth: contentWidthFor(cols),
        ...storeOverrides,
      })}
    >
      <Results />
    </StoreContext.Provider>,
    { cols },
  );
  const u = ui;
  // An empty list has no count in the panel title, so it is settled by its status line instead.
  const settledMark = results.length > 0 ? `Results (${results.length})` : "No results for";
  await vi.waitFor(() => expect(u.frame()).toContain(settledMark));
  return u;
}

// The detail panel's height comes from listRows, same as the list view. The default test
// listRows (14) leaves ~5 content rows after the search bar and panel chrome — enough for the
// pre-existing rows but not for five more metadata rows on top, so detail-view tests ask for a
// tall enough panel to actually see what they're asserting on instead of silently clipping it.
async function openDetail(u: RenderedUI): Promise<void> {
  u.press(KEY.enter);
  // "Magnet" is an unconditional detail-view row (present regardless of metadata state), so
  // waiting on it — rather than the result's own name, which the list view already shows —
  // actually proves the mode switch happened instead of matching the still-open list frame.
  await vi.waitFor(() => expect(u.frame()).toContain("Magnet"));
}

const lines = (u: RenderedUI): string[] => u.frame().split("\n");
const lineIndex = (u: RenderedUI, needle: string): number =>
  lines(u).findIndex((l) => l.includes(needle));
// A plain `.toContain("esc back")` still passes when the hint row is fused with stray content
// from an overflowing row above it (`esc back田`, `esc backLibby`) — the exact corruption this
// feature has produced before. This instead requires "esc back" to be followed by nothing but
// padding and the panel's own right border, which only a clean, unfused hint row satisfies.
const hintRowIntact = (u: RenderedUI): boolean =>
  lines(u).some((l) => /esc back\s*│$/.test(l));
// `.length` undercounts a CJK/emoji line (one JS unit, two terminal columns) by roughly half, so
// it stays "within budget" even when the real rendered line is corrupted or overflowing — the
// exact blind spot that let a display-width bug through review with every existing test green.
// This uses the component's own `displayWidth`, not a second implementation that could quietly
// drift from it and give false confidence again.
const widthFits = (u: RenderedUI): void => {
  for (const l of lines(u)) expect(displayWidth(l)).toBeLessThanOrEqual(TEST_CONTENT_WIDTH);
};
// The TextField cursor renders as SGR inverse; nothing else in this view does.
const editing = (u: RenderedUI): boolean => u.rawFrame().includes(`${KEY.esc}[7m`);

async function openFilter(u: RenderedUI): Promise<void> {
  u.press("f");
  await vi.waitFor(() => expect(editing(u)).toBe(true));
}

// Lets a test change the query the way submitQuery does — on the mounted tree, so the effects
// keyed on it actually run — which a fresh render cannot express. Mirrors the setter-through-a-ref
// pattern useResultMeta.test.tsx uses for the same reason.
let setQuery: ((q: string) => void) | null = null;

function Queried({ cols }: { cols: number }) {
  const [q, setQ] = useState("linux iso");
  useEffect(() => {
    setQuery = setQ;
    return () => {
      setQuery = null;
    };
  }, []);
  return (
    <StoreContext.Provider
      value={makeTestStore({ query: q, cols, contentWidth: contentWidthFor(cols) })}
    >
      <Results />
    </StoreContext.Provider>
  );
}

async function type(u: RenderedUI, text: string, expectCount: number): Promise<void> {
  u.press(text);
  await vi.waitFor(() => expect(u.frame()).toContain(`(${expectCount})`));
}

describe("Results filter UI", () => {
  it("shows no filter bar by default", async () => {
    const u = await mount();
    expect(u.frame()).not.toContain("Filter");
  });

  it("renders the filter bar on its own row below an intact panel", async () => {
    const u = await mount();
    await openFilter(u);
    await type(u, "ubuntu 24", 3);

    const ls = lines(u);
    const top = ls.findIndex((l) => l.includes("╭─ Results"));
    const bar = ls.findIndex((l) => l.includes("Filter ❯"));
    const lastBorder = ls.reduce((acc, l, i) => (l.includes("╰") ? i : acc), -1);

    // The bug this guards against: the bar rendered as a row sibling of the
    // panel, landing on the top border line and squeezing the title.
    expect(ls[top]).toMatch(/^╭─ Results \(3\) ─+╮$/);
    expect(ls[top]).toHaveLength(TEST_CONTENT_WIDTH);
    expect(bar).toBeGreaterThan(lastBorder);
    for (const l of ls) expect(l.length).toBeLessThanOrEqual(TEST_CONTENT_WIDTH);
  });

  it("narrows live and ranks exact > in-order > scattered", async () => {
    const u = await mount();
    await openFilter(u);
    await type(u, "ubuntu 24", 3);

    const exact = lineIndex(u, "ubuntu 24.04 desktop");
    const inOrder = lineIndex(u, "ubuntu server");
    const scattered = lineIndex(u, "24 hour timelapse");
    expect(exact).toBeGreaterThan(-1);
    expect(inOrder).toBeGreaterThan(exact);
    expect(scattered).toBeGreaterThan(inOrder);
    expect(u.frame()).not.toContain("debian 12");
  });

  it("enter commits the filter and returns keys to the list", async () => {
    const u = await mount();
    await openFilter(u);
    await type(u, "iso", 6);
    u.press(KEY.enter);
    await vi.waitFor(() => expect(editing(u)).toBe(false));
    expect(u.frame()).toContain("Filter ❯ iso");

    u.press("j");
    await vi.waitFor(() => {
      const ls = lines(u);
      expect(ls.find((l) => l.includes("ubuntu server"))).toContain("❯");
    });
    expect(lines(u).find((l) => l.includes("ubuntu 24.04 desktop"))).not.toContain("❯");
  });

  it("esc leaves editing but keeps the filter applied", async () => {
    const u = await mount();
    await openFilter(u);
    await type(u, "iso", 6);
    u.press(KEY.esc);
    await vi.waitFor(() => expect(editing(u)).toBe(false));
    expect(u.frame()).toContain("Filter ❯ iso");
    expect(u.frame()).toContain("(6)");

    u.press("j");
    await vi.waitFor(() => {
      const ls = lines(u);
      expect(ls.find((l) => l.includes("ubuntu server"))).toContain("❯");
    });
  });

  it("ctrl+u then enter clears the filter and removes the bar", async () => {
    const u = await mount();
    await openFilter(u);
    await type(u, "arch", 1);
    u.press(KEY.ctrlU);
    await vi.waitFor(() => expect(u.frame()).toContain("(8)"));
    u.press(KEY.enter);
    await vi.waitFor(() => expect(u.frame()).not.toContain("Filter"));
    expect(u.frame()).toContain("Results (8)");
  });

  it("a zero-match filter never traps the user", async () => {
    const u = await mount();
    await openFilter(u);
    u.press("zzz");
    await vi.waitFor(() => expect(u.frame()).toContain("No results for"));
    u.press(KEY.enter);
    await vi.waitFor(() => expect(editing(u)).toBe(false));
    expect(u.frame()).toContain("Filter ❯ zzz");

    u.press("f");
    await vi.waitFor(() => expect(editing(u)).toBe(true));
    u.press(KEY.ctrlU);
    // Wait between keys: TextField's input closure only refreshes on render,
    // so a same-batch ctrl+u + enter would still submit the pre-clear value
    // (pre-existing TextField trait, logged as a follow-up).
    await vi.waitFor(() => expect(u.frame()).toContain("Results (8)"));
    u.press(KEY.enter);
    await vi.waitFor(() => expect(u.frame()).not.toContain("Filter"));
    expect(u.frame()).toContain("Results (8)");
  });
});

const MOVIE_META: Meta = {
  imdbId: "tt0111161",
  kind: "movie",
  title: "The Shawshank Redemption",
  year: "1994",
  rating: "9.3",
  runtime: "142 min",
  genres: ["Drama"],
  cast: ["Tim Robbins", "Morgan Freeman"],
  director: ["Frank Darabont"],
  plot: "A banker convicted of murdering his wife forms a friendship over a number of years.",
};

// Cinemeta sends null director for series; an empty array is the routine shape here, not an
// edge case, which is exactly why the "no Director row" guard below matters.
const SERIES_META: Meta = {
  imdbId: "tt0944947",
  kind: "series",
  title: "Game of Thrones",
  year: "2011–2019",
  rating: "9.2",
  genres: ["Drama", "Fantasy"],
  cast: ["Emilia Clarke", "Kit Harington"],
  director: [],
  plot: "Nine noble families fight for control of the mythical land of Westeros.",
};

// Tall enough that the detail panel's fixed height (derived from listRows) never clips a row
// these tests assert on — the default test listRows only fits the pre-existing rows.
const TALL_DETAIL_STORE = { listRows: 40 };

describe("Results detail metadata", () => {
  it("renders rating, genres, director, cast and plot when metadata is present", async () => {
    const u = await mount(LIST, TALL_DETAIL_STORE, { loading: false, meta: MOVIE_META });
    await openDetail(u);

    const frame = u.frame();
    expect(frame).toContain("Rating");
    expect(frame).toContain("9.3 / 10");
    expect(frame).toContain("Genres");
    expect(frame).toContain("Drama");
    expect(frame).toContain("Director");
    expect(frame).toContain("Frank Darabont");
    expect(frame).toContain("Cast");
    expect(frame).toContain("Tim Robbins, Morgan Freeman");
    expect(frame).toContain("Plot");
    expect(frame).toContain("A banker convicted of murdering his wife");

    widthFits(u);
  });

  it("renders none of the metadata rows when meta is null", async () => {
    const u = await mount(LIST, TALL_DETAIL_STORE, IDLE_META);
    await openDetail(u);

    // The existing rows still render exactly as before...
    expect(u.frame()).toContain("Magnet");
    // ...but nothing new appears: no error row, no placeholder, no partial label.
    expect(u.frame()).not.toContain("Rating");
    expect(u.frame()).not.toContain("Genres");
    expect(u.frame()).not.toContain("Director");
    expect(u.frame()).not.toContain("Cast");
    expect(u.frame()).not.toContain("Plot");

    widthFits(u);
  });

  it("omits the Director row for a series with no director", async () => {
    const u = await mount(LIST, TALL_DETAIL_STORE, { loading: false, meta: SERIES_META });
    await openDetail(u);

    const frame = u.frame();
    // Metadata that does exist still renders...
    expect(frame).toContain("Cast");
    expect(frame).toContain("Emilia Clarke");
    // ...but an empty director list produces no row at all, not a blank one.
    expect(frame).not.toContain("Director");

    widthFits(u);
  });
});

// The maximum shape Meta's own caps allow: 6 genres, 12 cast, 3 directors, an 800-char plot.
// Exercises the metadata layout budget at its worst case, not just a comfortable one.
const MAX_META: Meta = {
  imdbId: "tt0111161",
  kind: "movie",
  title: "The Shawshank Redemption",
  year: "1994",
  rating: "9.3",
  runtime: "142 min",
  genres: ["Drama", "Crime", "Prison", "Redemption", "Friendship", "Hope"],
  cast: [
    "Tim Robbins",
    "Morgan Freeman",
    "Bob Gunton",
    "William Sadler",
    "Clancy Brown",
    "Gil Bellows",
    "Mark Rolston",
    "James Whitmore",
    "Jeffrey DeMunn",
    "Larry Brandenburg",
    "Neil Giuntoli",
    "Brian Libby",
  ],
  director: ["Frank Darabont", "Second Director", "Third Director"],
  plot: "A".repeat(800),
};

describe("Results detail metadata at a realistic terminal height", () => {
  // App.tsx's own listRows formula gives 17 for a standard 24-row terminal — the height that
  // matters for real usage, as opposed to TALL_DETAIL_STORE's 40, which exists purely to pin the
  // full, unclipped rendering path above. At this height the detail panel's inner content area
  // (Panel's height minus its own bottom border) is exactly 11 rows, and the six torrent-fact
  // rows below already use all 11 once Files and Added both apply — leaving no room for any
  // metadata row at all, which the first test asserts holds up even under MAX_META.
  const REALISTIC_STORE = { listRows: 17 };

  it("keeps every torrent fact and the action hint intact, even with MAX_META and no room to spare", async () => {
    const withFiles = [{ ...t("a1", "ubuntu 24.04 desktop amd64 iso"), numFiles: 3 }];
    const u = await mount(withFiles, REALISTIC_STORE, { loading: false, meta: MAX_META });
    await openDetail(u);

    const frame = u.frame();
    // The row order and content that existed before this feature must survive completely
    // unchanged: nothing dropped from the top, nothing fused, nothing renamed.
    expect(frame).toContain("ubuntu 24.04 desktop");
    expect(frame).toContain("Size");
    expect(frame).toContain("Health");
    expect(frame).toContain("Files");
    expect(frame).toContain("Added");
    expect(frame).toContain("Hash");
    expect(frame).toContain("Magnet");
    expect(frame).toContain("d Download");
    expect(hintRowIntact(u)).toBe(true);

    widthFits(u);
  });

  it("drops genres, director and cast as one unit once genres fails to fit, while rating and plot survive on either side of the gap", async () => {
    // No numFiles or Added on this result, so the facts block is two rows shorter than the test
    // above — budget 2 rather than 0. Rating (1 line) is admitted first, leaving 1. Genres needs 2
    // lines for MAX_META's six genres and does not fit, which cuts off every row after it in that
    // all-or-nothing group — including Director, whose own three names *would* fit in the 1 line
    // Genres left behind (1 <= 1) if admitted independently. Showing Director there anyway is
    // exactly the bug a prior, unreviewed version of this fix had: it admitted each of
    // genres/director/cast independently instead of sharing one cutoff, so Director rendered while
    // Genres, ranked above it, did not — a row missing from the middle of that group. Plot is a
    // deliberate exception to the cutoff (see planMetaRows' doc comment) and still claims the 1
    // line Genres left unclaimed, so the real, intended result has a gap — Genres/Director/Cast
    // all missing — between Rating and Plot, not "no gap at all".
    const minimal = { ...t("a1", "ubuntu 24.04 desktop amd64 iso"), numFiles: undefined, added: undefined };
    const u = await mount([minimal], REALISTIC_STORE, { loading: false, meta: MAX_META });
    await openDetail(u);

    const frame = u.frame();
    // The title row is the loudest signature of this class of corruption — it's the first thing
    // Yoga's shrink math squeezes away when the panel overflows.
    expect(frame).toContain("ubuntu 24.04 desktop");
    expect(frame).toContain("Rating");
    expect(frame).toContain("9.3 / 10");
    expect(frame).not.toContain("Genres");
    expect(frame).not.toContain("Director");
    expect(frame).not.toContain("Cast");
    expect(frame).toContain("Plot");
    // The facts and hint rows are unaffected by how much metadata budget is left.
    expect(frame).toContain("Magnet");
    expect(frame).toContain("d Download");
    expect(hintRowIntact(u)).toBe(true);

    widthFits(u);
  });

  it("hard-breaks a single unbreakable token so it cannot undercount its way past the budget", async () => {
    // No spaces at all — nothing for the greedy word-wrapper to break on except its hard
    // per-character fallback. Without that fallback this "word" is undercounted as one line when
    // it actually needs many, which is exactly what let a single unbroken run of text blow through
    // a budget that looked, on paper, like it had room to spare (the original Critical bug, and
    // the plot's 800-char stress case is unbroken text for the same reason). A tight budget is
    // required to make the miscount visible: at a generous budget the same miscount just leaves
    // unused slack, so this reuses REALISTIC_STORE with a fact row dropped rather than
    // TALL_DETAIL_STORE.
    const unbreakable = "X".repeat(600);
    const meta: Meta = { ...MAX_META, genres: [], cast: [], director: [unbreakable] };
    const minimal = { ...t("a1", "ubuntu 24.04 desktop amd64 iso"), numFiles: undefined, added: undefined };
    const u = await mount([minimal], REALISTIC_STORE, { loading: false, meta });
    await openDetail(u);

    const frame = u.frame();
    expect(frame).toContain("ubuntu 24.04 desktop");
    expect(frame).toContain("Magnet");
    expect(frame).toContain("d Download");
    expect(hintRowIntact(u)).toBe(true);

    widthFits(u);
  });
});

// Nyaa (one of torlink's own sources) is an anime index, and Cinemeta routinely returns CJK cast
// and plot text for Japanese/Korean/Chinese titles — this is a routine path, not an edge case.
// Each CJK character is one JS string unit but two terminal columns, which a length-based layout
// budget silently undercounts by half; these pin the fix at the reviewer's own repro shapes.
describe("Results detail metadata with CJK text", () => {
  const REALISTIC_STORE = { listRows: 17 };

  const CJK_CAST = [
    "田中誠",
    "鈴木一郎",
    "佐藤健二",
    "高橋美咲",
    "伊藤大輔",
    "渡辺直樹",
    "山本花子",
    "中村和也",
    "小林優子",
    "加藤誠一",
    "吉田真央",
    "山田太郎",
  ];

  const cjkCastMeta: Meta = { ...MAX_META, cast: CJK_CAST, genres: ["Drama"], director: [] };
  // Genres/director cleared and plot dropped so Cast is the only thing competing for budget —
  // needed for the "admitted and rendered" tests below, where the point is to actually exercise
  // the wide-char measurement on a multi-line wrapped value, not just an admit/reject decision.
  const cjkCastOnlyMeta: Meta = { ...MAX_META, cast: CJK_CAST, genres: [], director: [], plot: undefined };
  const cjkPlotMeta: Meta = {
    ...MAX_META,
    cast: [],
    genres: [],
    director: [],
    plot: "本作は刑務所を舞台にした友情と希望の物語である。".repeat(20),
  };

  it("renders a CJK cast without corruption at listRows=17, budget 2 (reviewer's exact repro)", async () => {
    // No numFiles or Added — the same budget-2 shape as the mutant-killing test above. Budget 2
    // cannot admit a 3-line CJK cast list regardless of how it's measured (Rating alone already
    // takes 1), so this specifically pins "still renders cleanly when correctly rejected" — it is
    // not the test that exercises the wide-char table on admitted content; see the two tests below
    // for that.
    const minimal = { ...t("a1", "ubuntu 24.04 desktop amd64 iso"), numFiles: undefined, added: undefined };
    const u = await mount([minimal], REALISTIC_STORE, { loading: false, meta: cjkCastMeta });
    await openDetail(u);

    const frame = u.frame();
    expect(frame).toContain("ubuntu 24.04 desktop");
    expect(frame).toContain("Size");
    expect(frame).toContain("Health");
    expect(frame).toContain("Hash");
    expect(frame).toContain("Magnet");
    expect(frame).toContain("d Download");
    expect(hintRowIntact(u)).toBe(true);

    widthFits(u);
  });

  it("admits and renders a CJK cast at listRows=20 with just enough budget to fit it", async () => {
    // Minimal facts (no numFiles/Added) plus an otherwise-empty meta gives budget 5 at
    // listRows=20: Rating (1) + the CJK cast's real 3-line wrap = 4, with 1 line to spare — tight
    // enough that a wrong (undercounted) line-count prediction changes the outcome, unlike a
    // generous budget where the same miscount just wastes slack invisibly.
    const minimal = { ...t("a1", "ubuntu 24.04 desktop amd64 iso"), numFiles: undefined, added: undefined };
    const u = await mount([minimal], { listRows: 20 }, { loading: false, meta: cjkCastOnlyMeta });
    await openDetail(u);

    const frame = u.frame();
    expect(frame).toContain("ubuntu 24.04 desktop");
    expect(frame).toContain("Size");
    expect(frame).toContain("Health");
    expect(frame).toContain("Hash");
    expect(frame).toContain("Magnet");
    expect(frame).toContain("Cast");
    for (const name of CJK_CAST) expect(frame).toContain(name);
    expect(frame).toContain("d Download");
    expect(hintRowIntact(u)).toBe(true);

    widthFits(u);
  });

  it("renders a CJK plot without corruption at listRows=20", async () => {
    const withFiles = [{ ...t("a1", "ubuntu 24.04 desktop amd64 iso"), numFiles: 3 }];
    const u = await mount(withFiles, { listRows: 20 }, { loading: false, meta: cjkPlotMeta });
    await openDetail(u);

    const frame = u.frame();
    expect(frame).toContain("ubuntu 24.04 desktop");
    expect(frame).toContain("Size");
    expect(frame).toContain("Health");
    expect(frame).toContain("Files");
    expect(frame).toContain("Added");
    expect(frame).toContain("Hash");
    expect(frame).toContain("Magnet");
    expect(frame).toContain("d Download");
    expect(hintRowIntact(u)).toBe(true);

    widthFits(u);
  });

  it("renders a full CJK cast list unclipped at a tall terminal", async () => {
    const u = await mount(LIST, TALL_DETAIL_STORE, { loading: false, meta: cjkCastMeta });
    await openDetail(u);

    const frame = u.frame();
    expect(frame).toContain("ubuntu 24.04 desktop");
    expect(frame).toContain("Cast");
    // All twelve names present somewhere in the wrapped, multi-line Cast value.
    for (const name of CJK_CAST) expect(frame).toContain(name);
    expect(frame).toContain("d Download");
    expect(hintRowIntact(u)).toBe(true);

    widthFits(u);
  });
});

// Astral code points (emoji outside the BMP, CJK Extension B+ ideographs) get no free ride from
// `.length` the way a BMP character never did either — `for...of` yields one code point per
// surrogate pair, so an unlisted astral range undercounts exactly like an unlisted BMP one. A
// prior version of this file's width table left every astral range out on the theory that
// `.length` already "handled" them, which reproduced the original Critical bug on emoji plots.
describe("Results detail metadata with astral and BMP emoji", () => {
  const clapperMeta: Meta = {
    imdbId: "tt3", kind: "movie", title: "t", rating: "8.0",
    genres: [], cast: [], director: [], plot: "🎬".repeat(200),
  };
  const starMeta: Meta = {
    imdbId: "tt4", kind: "movie", title: "t", rating: "8.0",
    genres: [], cast: [], director: [], plot: "⭐".repeat(200),
  };

  it("renders an astral emoji (clapper board) plot without corruption at listRows=20", async () => {
    const withFiles = [{ ...t("a1", "ubuntu 24.04 desktop amd64 iso"), numFiles: 3 }];
    const u = await mount(withFiles, { listRows: 20 }, { loading: false, meta: clapperMeta });
    await openDetail(u);

    const frame = u.frame();
    expect(frame).toContain("ubuntu 24.04 desktop");
    expect(frame).toContain("Size");
    expect(frame).toContain("Health");
    expect(frame).toContain("Files");
    expect(frame).toContain("Added");
    expect(frame).toContain("Hash");
    expect(frame).toContain("Magnet");
    expect(frame).toContain("d Download");
    expect(hintRowIntact(u)).toBe(true);

    widthFits(u);
  });

  it("renders a BMP emoji (star) plot without corruption at listRows=20", async () => {
    const withFiles = [{ ...t("a1", "ubuntu 24.04 desktop amd64 iso"), numFiles: 3 }];
    const u = await mount(withFiles, { listRows: 20 }, { loading: false, meta: starMeta });
    await openDetail(u);

    const frame = u.frame();
    expect(frame).toContain("ubuntu 24.04 desktop");
    expect(frame).toContain("Size");
    expect(frame).toContain("Health");
    expect(frame).toContain("Files");
    expect(frame).toContain("Added");
    expect(frame).toContain("Hash");
    expect(frame).toContain("Magnet");
    expect(frame).toContain("d Download");
    expect(hintRowIntact(u)).toBe(true);

    widthFits(u);
  });
});

// The pane lives or dies by frame integrity, not by line length: Ink clips a too-wide row to the
// panel it is in, so a pane that overflows never shows up as an over-wide line — it shows up as
// rows dropped or fused somewhere in the block. Every assertion below is therefore about what is
// present and where, with width checked on top rather than instead.
describe("Results info pane", () => {
  // 120 columns is the first tier that carries a poster in Task 6 and the width the pane was
  // designed against; the layout numbers come from previewLayout so they cannot drift from it.
  const WIDE_COLS = 120;
  const WIDE_CONTENT = contentWidthFor(WIDE_COLS);
  const PL = previewLayout(WIDE_CONTENT);

  // The results panel's own top border row — the search bar draws one of these too, above it.
  const topBorder = (u: RenderedUI): string => lines(u)[lineIndex(u, "╭─ Results")] ?? "";
  const paneOpen = (u: RenderedUI): boolean => u.frame().includes("╭─ Info");

  it("splits the top border between an intact results panel and the pane", async () => {
    const u = await mount(LIST, {}, { loading: false, meta: MOVIE_META }, WIDE_COLS);

    expect(PL).not.toBeNull();
    if (PL === null) return;
    const top = topBorder(u);
    // The list panel's own border is byte-for-byte what it always was, just narrower...
    expect(top.slice(0, PL.list)).toMatch(/^╭─ Results \(\d+\) ─+╮$/);
    // ...and the pane's sits beside it, one gap column over, with nothing fused in between.
    expect(top.slice(PL.list + 1)).toMatch(/^╭─ Info ─+╮$/);
    expect(displayWidth(top)).toBe(WIDE_CONTENT);
  });

  it("renders the row's metadata as a card, not just a title", async () => {
    const u = await mount(LIST, {}, { loading: false, meta: MOVIE_META }, WIDE_COLS);

    const frame = u.frame();
    expect(frame).toContain("The Shawshank Redemption");
    expect(frame).toContain(`1994 ${ICON.dot} 9.3 ${ICON.dot} 142 min`);
    expect(frame).toContain("Drama");
    expect(frame).toContain("Dir Frank Darabont");
    expect(frame).toContain("Cast Tim Robbins");
    // The list is still the point of the view: nothing it used to show has moved out of frame.
    expect(frame).toContain("ubuntu 24.04 desktop");
    expect(frame).toContain("Size");
    for (const l of lines(u)) expect(displayWidth(l)).toBeLessThanOrEqual(WIDE_CONTENT);
  });

  it("names a matched episode with its series title", async () => {
    const episodeMeta: Meta = {
      ...SERIES_META,
      episode: { season: 3, number: 7, title: "The Bear and the Maiden Fair" },
    };
    const u = await mount(LIST, {}, { loading: false, meta: episodeMeta }, WIDE_COLS);

    const frame = u.frame();
    expect(frame).toContain("Game of Thrones");
    expect(frame).toContain(`S03E07 ${ICON.dot} The Bear`);
  });

  it("says No metadata — never an error — when there is nothing to show", async () => {
    const u = await mount(LIST, {}, IDLE_META, WIDE_COLS);

    expect(u.frame()).toContain("No metadata");
    // A Games row, an unmatched release and a dead network all land here, and none of them is a
    // failure of the search the user actually ran.
    for (const shout of ["rror", "ailed", "nable", "Couldn't"]) {
      expect(u.frame()).not.toContain(shout);
    }
    // Dim, and only dim: chalk emits SGR 2 and no colour of its own around it.
    expect(u.rawFrame()).toContain(`${KEY.esc}[2mNo metadata`);
  });

  it("shows a spinner rather than a verdict while the lookup is still out", async () => {
    const u = await mount(LIST, {}, { loading: true, meta: null }, WIDE_COLS);

    expect(paneOpen(u)).toBe(true);
    expect(u.frame()).not.toContain("No metadata");
  });

  it("i closes the pane, gives the list its columns back, and reopens it", async () => {
    const u = await mount(LIST, {}, { loading: false, meta: MOVIE_META }, WIDE_COLS);
    expect(paneOpen(u)).toBe(true);

    u.press("i");
    await vi.waitFor(() => expect(paneOpen(u)).toBe(false));
    // Closed means the list is whole again, not merely that the card is hidden.
    expect(topBorder(u)).toMatch(/^╭─ Results \(\d+\) ─+╮$/);
    expect(displayWidth(topBorder(u))).toBe(WIDE_CONTENT);
    expect(u.frame()).not.toContain("The Shawshank Redemption");

    u.press("i");
    await vi.waitFor(() => expect(paneOpen(u)).toBe(true));
    expect(u.frame()).toContain("The Shawshank Redemption");
  });

  it("toggles on an empty list, where the user is most likely to want the columns back", async () => {
    // The binding sits above the `results.length === 0` early return for exactly this; moved
    // below it, the key would go dead on the one view whose emptiness invites the question.
    const u = await mount([], {}, IDLE_META, WIDE_COLS);
    expect(paneOpen(u)).toBe(true);

    u.press("i");
    await vi.waitFor(() => expect(paneOpen(u)).toBe(false));
  });

  it("survives a new query", async () => {
    // The pane is a preference, not view state. It shares an effect's neighbourhood with
    // textFilter, which the query change deliberately clears — this pins that the toggle is not
    // swept up with it.
    searchState.current = settled(LIST);
    metaState.current = { loading: false, meta: MOVIE_META };
    ui = renderUI(<Queried cols={WIDE_COLS} />, { cols: WIDE_COLS });
    const u = ui;
    await vi.waitFor(() => expect(u.frame()).toContain("Results (8)"));

    u.press("i");
    await vi.waitFor(() => expect(paneOpen(u)).toBe(false));

    setQuery?.("arch iso");
    await vi.waitFor(() => expect(u.frame()).toContain("arch iso"));
    expect(paneOpen(u)).toBe(false);
  });

  it("keeps j and k moving the cursor with the pane open", async () => {
    const u = await mount(LIST, {}, { loading: false, meta: MOVIE_META }, WIDE_COLS);

    u.press("j");
    await vi.waitFor(() => {
      expect(lines(u).find((l) => l.includes("ubuntu server"))).toContain(ICON.pointer);
    });
    expect(paneOpen(u)).toBe(true);

    u.press("k");
    await vi.waitFor(() => {
      expect(lines(u).find((l) => l.includes("ubuntu 24.04 desktop"))).toContain(ICON.pointer);
    });
    // The split survived the movement: no row of the list fused into the pane's border.
    expect(topBorder(u).slice(0, PL?.list ?? 0)).toMatch(/^╭─ Results \(\d+\) ─+╮$/);
  });

  it("holds together on the narrowest tier that renders it", async () => {
    // 92 columns is the first width the pane exists at: 20 wide, 16 usable inside Panel's frame.
    // Everything here is wrapping against roughly half the width the card was designed at, which
    // is where a line-count miscount turns into a fused row rather than an unused one.
    const NARROW_COLS = 92;
    const narrowContent = contentWidthFor(NARROW_COLS);
    const nl = previewLayout(narrowContent);
    const u = await mount(LIST, {}, { loading: false, meta: MOVIE_META }, NARROW_COLS);

    expect(nl).not.toBeNull();
    if (nl === null) return;
    expect(nl.pane).toBe(20);
    const top = topBorder(u);
    expect(top.slice(0, nl.list)).toMatch(/^╭─ Results \(\d+\) ─+╮$/);
    expect(top.slice(nl.list + 1)).toMatch(/^╭─ Info ─+╮$/);
    // The card sheds its lower rows rather than overflowing: the title survives whole, wrapped.
    expect(u.frame()).toContain("The Shawshank");
    expect(u.frame()).toContain("Redemption");
    // Every row of the list is still a row of the list — nothing fused across the gap. The name
    // column truncates at this width, so the row is identified by the prefix that survives it.
    expect(lines(u).filter((l) => l.includes("ubuntu 24.04 des"))).toHaveLength(1);
    expect(lines(u).filter((l) => l.includes("mint cinnamon"))).toHaveLength(0);
    for (const l of lines(u)) expect(displayWidth(l)).toBeLessThanOrEqual(narrowContent);
  });

  it("is absent at 80 columns, where the list needs every column it has", async () => {
    const u = await mount(LIST, {}, { loading: false, meta: MOVIE_META });

    expect(paneOpen(u)).toBe(false);
    expect(u.frame()).not.toContain("The Shawshank Redemption");
    expect(u.frame()).not.toContain("No metadata");
    widthFits(u);
  });

  it("still opens the detail view over a narrowed list", async () => {
    const u = await mount(LIST, { listRows: 40 }, { loading: false, meta: MOVIE_META }, WIDE_COLS);
    await openDetail(u);

    const frame = u.frame();
    expect(frame).toContain("Magnet");
    expect(frame).toContain("Rating");
    // Both mounted at once on the same row — the case Task 3's refcounted dedupe exists for.
    expect(paneOpen(u)).toBe(true);
    // The detail view's hint row no longer runs to the frame's edge, so intactness is asked of
    // the columns the list panel actually owns: still one clean row ending at its own border.
    const hintRow = lines(u).find((l) => l.includes("esc back")) ?? "";
    expect(hintRow.slice(0, PL?.list ?? 0)).toMatch(/esc back\s*│$/);
    for (const l of lines(u)) expect(displayWidth(l)).toBeLessThanOrEqual(WIDE_CONTENT);
  });
});

// The pane with the keyboard in it. Region "preview" is the whole input to this view — App owns
// the key that produces it (move.test.ts pins that walk) and Results owns what it looks like.
describe("Results info pane focused", () => {
  const WIDE_COLS = 120;
  const WIDE_CONTENT = contentWidthFor(WIDE_COLS);
  const IDLE = previewLayout(WIDE_CONTENT);
  const READING = previewLayout(WIDE_CONTENT, true);

  const topBorder = (u: RenderedUI): string => lines(u)[lineIndex(u, "╭─ Results")] ?? "";
  const paneOpen = (u: RenderedUI): boolean => u.frame().includes("╭─ Info");
  // Panel's two frame colours as chalk emits them: COLOR.accent for the focused panel, RULE for
  // every other one.
  const ACCENT = "[38;2;167;139;250m";
  const DIM = "[38;2;107;101;119m";
  // Both panels draw their top border on the same line, so "is this label accented" is a question
  // about which colour was opened last before it — not about the frame containing the code at all.
  const accented = (raw: string, label: string): boolean => {
    const head = raw.slice(0, raw.indexOf(label));
    return head.lastIndexOf(ACCENT) > head.lastIndexOf(DIM);
  };

  it("hands the pane every column the list can spare", async () => {
    const u = await mount(LIST, { region: "preview" }, { loading: false, meta: MOVIE_META }, WIDE_COLS);

    expect(READING).not.toBeNull();
    if (READING === null || IDLE === null) return;
    expect(READING.pane).toBeGreaterThan(IDLE.pane);
    const top = topBorder(u);
    // The same two-panel border as unfocused, at the focused split's widths: the list narrower,
    // the pane wider, and the gap column still between them.
    expect(top.slice(0, READING.list)).toMatch(/^╭─ Results \(\d+\) ─+╮$/);
    expect(top.slice(READING.list + 1)).toMatch(/^╭─ Info ─+╮$/);
    expect(displayWidth(top)).toBe(WIDE_CONTENT);
    // The list is still a list: its rows are all still rows, none fused into the pane. At
    // MIN_LIST_WIDTH the name column truncates, so each row is identified by what survives it.
    expect(lines(u).filter((l) => l.includes("ubuntu 24"))).toHaveLength(1);
    expect(lines(u).filter((l) => l.includes("ubuntu se"))).toHaveLength(1);
    for (const l of lines(u)) expect(displayWidth(l)).toBeLessThanOrEqual(WIDE_CONTENT);
  });

  it("moves the accent from the list's frame to the pane's", async () => {
    const browsing = await mount(LIST, {}, { loading: false, meta: MOVIE_META }, WIDE_COLS);
    expect(accented(browsing.rawFrame(), "Results")).toBe(true);
    expect(accented(browsing.rawFrame(), "Info")).toBe(false);
    browsing.unmount();

    const reading = await mount(
      LIST,
      { region: "preview" },
      { loading: false, meta: MOVIE_META },
      WIDE_COLS,
    );
    // One highlight idiom, moved — not a second one added.
    expect(accented(reading.rawFrame(), "Results")).toBe(false);
    expect(accented(reading.rawFrame(), "Info")).toBe(true);
  });

  it("keeps the list pointing at the row the pane is describing, and stops taking its keys", async () => {
    const u = await mount(LIST, { region: "preview" }, { loading: false, meta: MOVIE_META }, WIDE_COLS);

    // The name column truncates at MIN_LIST_WIDTH, so rows are identified by their prefixes.
    const marked = (name: string): boolean =>
      (lines(u).find((l) => l.includes(name)) ?? "").includes(ICON.pointer);
    // Losing the marker would leave the card describing a row nothing on screen identifies.
    expect(marked("ubuntu 24")).toBe(true);

    u.press("j");
    await new Promise((r) => setTimeout(r, 20));
    // j belongs to the pane now: the cursor has not moved to the second row.
    expect(marked("ubuntu 24")).toBe(true);
    expect(marked("ubuntu se")).toBe(false);
  });

  it("tells App the pane is there, so → has somewhere to go", async () => {
    const setPreviewOpen = vi.fn();
    await mount(LIST, { setPreviewOpen }, { loading: false, meta: MOVIE_META }, WIDE_COLS);
    expect(setPreviewOpen).toHaveBeenLastCalledWith(true);
  });

  it("tells App there is nothing to step into at 80 columns", async () => {
    const setPreviewOpen = vi.fn();
    const u = await mount(LIST, { setPreviewOpen }, { loading: false, meta: MOVIE_META });
    expect(setPreviewOpen).toHaveBeenLastCalledWith(false);
    expect(paneOpen(u)).toBe(false);
  });

  it("renders the list alone, full width, if focus somehow points at a pane that is not there", async () => {
    // Unreachable through the keys — stepRegion refuses it and App's rescue effect undoes it —
    // but a region and a width that disagree must degrade to the frame that has always been
    // correct at 80 columns rather than to a pane with nowhere to draw.
    const u = await mount(LIST, { region: "preview" }, { loading: false, meta: MOVIE_META });
    expect(paneOpen(u)).toBe(false);
    expect(topBorder(u)).toMatch(/^╭─ Results \(\d+\) ─+╮$/);
    expect(displayWidth(topBorder(u))).toBe(TEST_CONTENT_WIDTH);
    widthFits(u);
  });
});

describe("Results info pane on Games", () => {
  const WIDE_COLS = 120;
  const WIDE_CONTENT = contentWidthFor(WIDE_COLS);
  // A row from a Games-only source, so the tab has results to show while having no metadata
  // provider behind them.
  const GAMES = [{ ...t("g1", "some.repack-FitGirl"), source: "fitgirl" as const }];

  it("hides the pane and gives the list back its columns", async () => {
    const setPreviewOpen = vi.fn();
    const u = await mount(
      GAMES,
      { section: "games", setPreviewOpen },
      { loading: false, meta: MOVIE_META },
      WIDE_COLS,
    );

    // Nothing looks up a game, so the pane would be a column of "No metadata" — and with it gone,
    // → has nothing to step into either.
    expect(u.frame()).not.toContain("╭─ Info");
    expect(u.frame()).not.toContain("No metadata");
    expect(setPreviewOpen).toHaveBeenLastCalledWith(false);
    const top = lines(u)[lineIndex(u, "╭─ Results")] ?? "";
    expect(top).toMatch(/^╭─ Results \(1\) ─+╮$/);
    expect(displayWidth(top)).toBe(WIDE_CONTENT);
  });

  it("keeps the pane on every tab that does have metadata", async () => {
    // `all` carries video and stays in, which is the other half of the rule: its Games rows
    // already answer "No metadata" one row at a time, unlike a tab that can never answer more.
    // Each tab is given a row from one of its own sources, since the tab filters the list.
    const rows = {
      all: LIST,
      movies: LIST,
      tv: [{ ...t("t1", "some.series.s01e01"), source: "eztv" as const }],
      anime: [{ ...t("n1", "some anime 01"), source: "nyaa" as const }],
    };
    for (const section of ["all", "movies", "tv", "anime"] as const) {
      const u = await mount(rows[section], { section }, { loading: false, meta: MOVIE_META }, WIDE_COLS);
      expect(u.frame(), section).toContain("╭─ Info");
      u.unmount();
    }
  });
});

// Ink answers an overflowing box by squeezing rows through Yoga's shrink math, which drops and
// fuses lines anywhere in the block rather than cutting the one that overflowed — so the proof
// that a two-panel split holds is that every row is still a row, at its own panel's exact width,
// with the gap column between them still blank. This sweeps the sizes and content shapes that
// each broke a different assumption while this feature was built.
describe("Results frame integrity", () => {
  const CJK_META: Meta = {
    imdbId: "tt0245429",
    kind: "movie",
    title: "千と千尋の神隠し ｜ 센과 치히로의 행방불명",
    year: "2001",
    rating: "8.6",
    runtime: "125 min",
    genres: ["アニメ", "冒険", "ファンタジー"],
    cast: ["柊瑠美", "入野自由", "夏木マリ", "内藤剛志"],
    director: ["宮崎駿"],
    posterUrl: "https://example.invalid/poster.jpg",
  };
  const WITH_POSTER: Meta = { ...MOVIE_META, posterUrl: "https://example.invalid/poster.jpg" };

  // App's own row arithmetic, so a case asking for a 17-row terminal gets the listRows the real
  // app would hand Results there.
  const listRowsFor = (rows: number): number => {
    const compact = rows < 18;
    const chrome = 3 + (compact ? 0 : 2) + (rows >= 12 ? 1 : 0);
    return Math.max(4, Math.max(6, rows - 1 - chrome));
  };

  const CASES: { name: string; meta: MetaState; art: boolean }[] = [
    { name: "poster", meta: { loading: false, meta: WITH_POSTER }, art: true },
    { name: "cjk", meta: { loading: false, meta: CJK_META }, art: true },
    { name: "no metadata", meta: IDLE_META, art: false },
  ];

  // Both panels' rows, from the shared top border down to the shared bottom one.
  const panelBlock = (u: RenderedUI, listRows: number): string[] => {
    const all = lines(u);
    const top = all.findIndex((l) => l.includes("╭─ Results"));
    expect(top).toBeGreaterThanOrEqual(0);
    return all.slice(top, top + resultsPanelOuter(listRows, 3) + 1);
  };

  it("holds both panels' frames across widths, heights, focus and metadata shapes", async () => {
    for (const cols of [80, 92, 100, 120, 130]) {
      for (const rows of [17, 26]) {
        for (const focused of [false, true]) {
          for (const c of CASES) {
            posterOn.current = c.art;
            const contentWidth = contentWidthFor(cols);
            const listRows = listRowsFor(rows);
            const pl = previewLayout(contentWidth, focused);
            const u = await mount(
              LIST,
              { rows, listRows, contentWidth, region: focused && pl !== null ? "preview" : "content" },
              c.meta,
              cols,
            );
            const where = `${cols}x${rows} focused=${focused} ${c.name}`;
            const block = panelBlock(u, listRows);
            for (const l of lines(u)) expect(displayWidth(l), `${where} "${l}"`).toBeLessThanOrEqual(contentWidth);

            if (pl === null) {
              // The 80-column floor: one panel, full width, exactly as it renders without any of
              // this — including when the region says the pane has focus.
              expect(u.frame(), where).not.toContain("╭─ Info");
              expect(block[0], where).toMatch(/^╭─ Results \(8\) ─+╮$/);
              expect(block.at(-1), where).toMatch(/^╰─+╯$/);
              for (const l of block.slice(1, -1)) {
                expect(displayWidth(l), `${where} row`).toBe(contentWidth);
              }
            } else {
              for (const [i, l] of block.entries()) {
                const left = l.slice(0, pl.list);
                const right = l.slice(pl.list + 1);
                expect(displayWidth(left), `${where} left#${i} "${l}"`).toBe(pl.list);
                expect(l.slice(pl.list, pl.list + 1), `${where} gap#${i}`).toBe(" ");
                expect(displayWidth(right), `${where} right#${i} "${right}"`).toBe(pl.pane);
                if (i === 0) {
                  expect(left, where).toMatch(/^╭─ Results \(8\) ─+╮$/);
                  expect(right, where).toMatch(/^╭─ Info ─+╮$/);
                } else if (i === block.length - 1) {
                  expect(left, where).toMatch(/^╰─+╯$/);
                  expect(right, where).toMatch(/^╰─+╯$/);
                } else {
                  expect(left.startsWith("│") && left.endsWith("│"), `${where} left "${left}"`).toBe(true);
                  expect(right.startsWith("│") && right.endsWith("│"), `${where} right "${right}"`).toBe(true);
                }
              }
              expect(u.frame(), where).toContain("ubuntu 24");
            }
            u.unmount();
          }
        }
      }
    }
    posterOn.current = false;
  });

  it("holds the same frame mid-scroll, where the art is cut and the affordance costs a row", async () => {
    posterOn.current = true;
    const cols = 120;
    const listRows = 12;
    const contentWidth = contentWidthFor(cols);
    const pl = previewLayout(contentWidth, true);
    const u = await mount(
      LIST,
      { listRows, contentWidth, region: "preview" },
      { loading: false, meta: WITH_POSTER },
      cols,
    );

    expect(pl).not.toBeNull();
    if (pl === null) return;
    expect(u.frame()).toContain(`${ICON.down} more`);
    u.press(`${KEY.esc}[6~`);
    // Proof the pane actually moved under the window, not just that it survived a keypress: the
    // affordance now points both ways, which is the state where the art is cut at top and bottom.
    await vi.waitFor(() => expect(u.frame()).toContain(`${ICON.up}${ICON.down} more`));

    for (const [i, l] of panelBlock(u, listRows).entries()) {
      expect(displayWidth(l.slice(0, pl.list)), `left#${i} "${l}"`).toBe(pl.list);
      expect(l.slice(pl.list, pl.list + 1), `gap#${i}`).toBe(" ");
      expect(displayWidth(l.slice(pl.list + 1)), `right#${i}`).toBe(pl.pane);
    }
    expect(u.frame()).toContain("ubuntu 24");
    posterOn.current = false;
  });
});
