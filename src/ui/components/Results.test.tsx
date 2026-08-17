import { afterEach, describe, expect, it, vi } from "vitest";
import { SOURCES } from "../../sources/registry";
import { StoreContext, type Store } from "../store";
import {
  KEY,
  makeTestStore,
  renderUI,
  TEST_CONTENT_WIDTH,
  type RenderedUI,
} from "../testHarness";
import { Results } from "./Results";
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

async function mount(
  results: TorrentResult[] = LIST,
  storeOverrides: Partial<Store> = {},
  meta: MetaState = IDLE_META,
): Promise<RenderedUI> {
  searchState.current = settled(results);
  metaState.current = meta;
  ui = renderUI(
    <StoreContext.Provider value={makeTestStore({ query: "linux iso", ...storeOverrides })}>
      <Results />
    </StoreContext.Provider>,
  );
  const u = ui;
  await vi.waitFor(() => expect(u.frame()).toContain(`Results (${results.length})`));
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
// The TextField cursor renders as SGR inverse; nothing else in this view does.
const editing = (u: RenderedUI): boolean => u.rawFrame().includes(`${KEY.esc}[7m`);

async function openFilter(u: RenderedUI): Promise<void> {
  u.press("f");
  await vi.waitFor(() => expect(editing(u)).toBe(true));
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

    for (const l of lines(u)) expect(l.length).toBeLessThanOrEqual(TEST_CONTENT_WIDTH);
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

    for (const l of lines(u)) expect(l.length).toBeLessThanOrEqual(TEST_CONTENT_WIDTH);
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

    for (const l of lines(u)) expect(l.length).toBeLessThanOrEqual(TEST_CONTENT_WIDTH);
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
    expect(frame).toContain("esc back");

    for (const l of lines(u)) expect(l.length).toBeLessThanOrEqual(TEST_CONTENT_WIDTH);
  });

  it("sheds metadata rows from the bottom of the block with no gap in the middle", async () => {
    // No numFiles on this result, so the facts block is one row shorter than the test above —
    // just enough budget for Rating alone. Genres needs two lines and does not fit, and once one
    // present row fails, every row below it (director, cast, plot) is dropped too — even though
    // Director's own three names would easily fit in what Genres left behind. Showing Director
    // there would be a hole in the middle of the block, which is exactly the failure mode this
    // pins against.
    const u = await mount([t("a1", "ubuntu 24.04 desktop amd64 iso")], REALISTIC_STORE, {
      loading: false,
      meta: MAX_META,
    });
    await openDetail(u);

    const frame = u.frame();
    expect(frame).toContain("Rating");
    expect(frame).toContain("9.3 / 10");
    expect(frame).not.toContain("Genres");
    expect(frame).not.toContain("Director");
    expect(frame).not.toContain("Cast");
    expect(frame).not.toContain("Plot");
    // The facts and hint rows are unaffected by how much metadata budget is left.
    expect(frame).toContain("Magnet");
    expect(frame).toContain("d Download");
    expect(frame).toContain("esc back");

    for (const l of lines(u)) expect(l.length).toBeLessThanOrEqual(TEST_CONTENT_WIDTH);
  });
});
