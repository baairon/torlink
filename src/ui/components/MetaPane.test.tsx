import { useEffect, useState } from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { MetaPane } from "./MetaPane";
import { KEY, renderUI } from "../testHarness";
import { displayWidth } from "../textWidth";
import { MIN_FOCUSED_TEXT_ROWS, posterBudget } from "../previewLayout";
import { ICON } from "../theme";
import { usePoster } from "../hooks/usePoster";
import { useResultMeta } from "../hooks/useResultMeta";
import { fitCells } from "../../meta/image";
import type { PosterCells } from "../../meta/image";
import type { Meta } from "../../meta/types";
import type { TorrentResult } from "../../sources/types";

// Both hooks are mocked: this file is about the pane's layout arithmetic — how many rows the art
// claims and how many are left for the text — not about fetching, which image.test.ts and
// poster.test.ts already cover. No test in this repo may touch the network, and a mocked hook is
// the only way to render the loaded state at all.
vi.mock("../hooks/useResultMeta", () => ({ useResultMeta: vi.fn() }));
vi.mock("../hooks/usePoster", () => ({ usePoster: vi.fn() }));

const mockMeta = vi.mocked(useResultMeta);
const mockPoster = vi.mocked(usePoster);

// The exhaustive sweep at the bottom of this file mounts the pane a few thousand times, which
// costs seconds even on an idle machine and rather more on a busy one. Vitest's five-second
// default is a number nobody here chose; this one is chosen, with room for a contributor's laptop
// running a build in the next window. A sweep that overruns it is a machine under load, not a
// slow test hiding a problem — so raise this rather than thinning the sweep, which is what caught
// the off-by-one layout bugs the cases below pin.
const SWEEP_MS = 20_000;

// The widest tier: pane 34 columns, and the panel height the results view hands it.
const PANE_W = 34;
const PANE_H = 20;
const INNER_ROWS = PANE_H - 1;
const BUDGET = posterBudget(PANE_W, INNER_ROWS);

const ROW: TorrentResult = {
  infoHash: "h-alpha",
  name: "The.Matrix.1999.1080p.BluRay.x264",
  source: "yts",
  sizeBytes: 2.1e9,
  seeders: 40,
  leechers: 6,
  magnet: "magnet:?xt=urn:btih:h-alpha",
};

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
  posterUrl: "https://images.metahub.space/poster/small/tt0133093/img?format=jpeg",
};

// A separate fixture rather than a plot on META: every other test in this file measures the facts
// card's rows, and a synopsis under it would change what all of them are asserting.
const META_PLOT: Meta = {
  ...META,
  plot:
    "A computer hacker learns from mysterious rebels about the true nature of his reality and " +
    "his role in the war against its controllers, who farm sleeping humanity for power.",
};

function art(cols: number, rows: number): PosterCells {
  return {
    cols,
    rows,
    lines: Array.from({ length: rows }, () => [{ fg: "#ff0000", bg: "#0000ff", n: cols }]),
  };
}

// Panel's focused frame colour, as chalk emits COLOR.accent (#a78bfa) in truecolour.
const ACCENT = "\u001b[38;2;167;139;250m";

// The CSI sequences ink's input parser turns into key.downArrow, key.pageUp and key.pageDown.
const DOWN = `${KEY.esc}[B`;
const PAGE_UP = `${KEY.esc}[5~`;
const PAGE_DOWN = `${KEY.esc}[6~`;

function frameLines(frame: string): string[] {
  // Trailing blank lines are the harness's, not the panel's; the panel's own bottom border is the
  // last line that carries anything.
  const all = frame.split("\n");
  let end = all.length;
  while (end > 0 && (all[end - 1] ?? "").trim() === "") end--;
  return all.slice(0, end);
}

beforeEach(() => {
  mockMeta.mockReset();
  mockPoster.mockReset();
  mockMeta.mockReturnValue({ loading: false, meta: META });
  mockPoster.mockReturnValue({ loading: false, cells: null });
});

describe("MetaPane poster slot", () => {
  it("asks for exactly the cell budget previewLayout sized for this pane", () => {
    renderUI(<MetaPane result={ROW} width={PANE_W} height={PANE_H} poster />).unmount();
    expect(BUDGET).not.toBeNull();
    expect(mockPoster).toHaveBeenCalledWith(META.posterUrl, BUDGET?.cols, BUDGET?.rows, true);
  });

  it("does not fetch art at a tier that does not draw it", () => {
    renderUI(<MetaPane result={ROW} width={20} height={PANE_H} poster={false} />).unmount();
    // Still called — hooks cannot be conditional — but disabled and with no budget to spend.
    expect(mockPoster).toHaveBeenCalledWith(META.posterUrl, 0, 0, false);
  });

  it("keeps every row of art, the spacer and the text inside the panel frame", () => {
    const rows = BUDGET?.rows ?? 0;
    const cols = BUDGET?.cols ?? 0;
    mockPoster.mockReturnValue({ loading: false, cells: art(cols, rows) });

    const ui = renderUI(<MetaPane result={ROW} width={PANE_W} height={PANE_H} poster />, {
      cols: 60,
    });
    const out = frameLines(ui.frame());

    // Title bar + the bordered content box, which draws its own bottom border inside `height`.
    expect(out).toHaveLength(1 + PANE_H);
    expect(out[0]).toContain("Info");
    expect(out.at(-1)?.startsWith("╰")).toBe(true);
    // Frame integrity beats a width assertion: Yoga answers overflow by fusing rows, so the proof
    // that nothing overflowed is that all of them are still here at the pane's exact width.
    for (const line of out) expect(displayWidth(line)).toBe(PANE_W);

    // Content rows: `rows` of art, one blank spacer, then the text card.
    const content = out.slice(1, -1);
    expect(content).toHaveLength(INNER_ROWS);
    for (let i = 0; i < rows; i++) expect(content[i]).toContain("▀".repeat(cols));
    expect(content[rows]?.replace(/│/g, "").trim()).toBe("");
    expect(content.slice(rows + 1).join("\n")).toContain("The Matrix");
    ui.unmount();
  });

  it("refuses to draw a grid that outgrew the pane it was decoded for", () => {
    // What a resize looks like for one frame: the hook re-keys inside an effect, so the render
    // that first sees the narrower pane is still holding the grid decoded for the wider one.
    mockPoster.mockReturnValue({
      loading: false,
      cells: art((BUDGET?.cols ?? 0) + 4, (BUDGET?.rows ?? 0) + 4),
    });
    const ui = renderUI(<MetaPane result={ROW} width={PANE_W} height={PANE_H} poster />, {
      cols: 60,
    });
    const out = frameLines(ui.frame());
    expect(out.join("")).not.toContain("▀");
    expect(out).toHaveLength(1 + PANE_H);
    for (const line of out) expect(displayWidth(line)).toBe(PANE_W);
    ui.unmount();
  });

  it("keeps the pane unfocused unless it is told otherwise", () => {
    // Panel paints its frame in the accent only for the focused region, and the pane beside the
    // list is not it until the user steps in. Task 5's default behaviour, pinned as a default.
    const ui = renderUI(<MetaPane result={ROW} width={PANE_W} height={PANE_H} poster />);
    expect(ui.rawFrame()).not.toContain(ACCENT);
    ui.unmount();
  });

  it("gives the text back the rows the art would have taken when there is no art", () => {
    // beforeEach leaves the poster hook answering null, which is what a WebP body, a 404, a
    // truncated download and a decode failure all look like from here.
    const bare = renderUI(<MetaPane result={ROW} width={PANE_W} height={PANE_H} poster />);
    const textOnly = bare.frame();
    bare.unmount();

    mockPoster.mockReturnValue({ loading: false, cells: art(BUDGET?.cols ?? 0, BUDGET?.rows ?? 0) });
    const drawn = renderUI(<MetaPane result={ROW} width={PANE_W} height={PANE_H} poster />);
    const withArt = drawn.frame();
    drawn.unmount();

    // A poster that never arrives leaves the card exactly as it renders today, cast line and all;
    // one that does arrive spends those rows on the art instead.
    expect(textOnly).toContain("Cast Keanu Reeves");
    expect(withArt).not.toContain("Cast Keanu Reeves");
    expect(withArt).toContain("The Matrix");
  });
});

describe("MetaPane plot", () => {
  it("spends the rows the facts card left over on the synopsis", () => {
    // Unfocused with art on screen there is exactly one row of slack under the credits, and the
    // plot is what claims it — the blank area under the cast line was the gap this closes.
    mockMeta.mockReturnValue({ loading: false, meta: META_PLOT });
    mockPoster.mockReturnValue({ loading: false, cells: art(BUDGET?.cols ?? 0, BUDGET?.rows ?? 0) });
    const ui = renderUI(<MetaPane result={ROW} width={PANE_W} height={PANE_H} poster />, {
      cols: 60,
    });
    const out = frameLines(ui.frame());

    expect(ui.frame()).toContain("A computer hacker");
    // The row is a cut fragment of a longer plot, and says so rather than reading as the whole of
    // a very short one.
    expect(ui.frame()).toContain("…");
    // Nothing overflowed to buy it: same frame, same width, art still whole.
    expect(out).toHaveLength(1 + PANE_H);
    for (const line of out) expect(displayWidth(line)).toBe(PANE_W);
    ui.unmount();
  });

  it("builds the whole synopsis for a focused pane and scrolls to the end of it", async () => {
    // Focused the planner is handed an infinite budget, so the plot arrives whole and the window
    // — not the card — decides what is on screen. No art, so the overflow is the text alone.
    mockMeta.mockReturnValue({ loading: false, meta: META_PLOT });
    const ui = renderUI(<MetaPane result={ROW} width={PANE_W} height={12} poster focused />, {
      cols: 60,
    });
    expect(ui.frame()).toContain("The Matrix");
    expect(ui.frame()).toContain(`${ICON.down} more`);

    ui.press(PAGE_DOWN);
    // The last words of the plot, which only exist on screen because nothing truncated it.
    await vi.waitFor(() => expect(ui.frame()).toContain("power."));
    const out = frameLines(ui.frame());
    expect(out).toHaveLength(1 + 12);
    for (const line of out) expect(displayWidth(line)).toBe(PANE_W);
    ui.unmount();
  });
});

// A focused pane too narrow to seat the card beside the picture: the art gives up rows instead of
// columns, the card sits under it, and one window scrolls the two. Every assertion here is about
// rows — which ones are on screen and how many — because that is what scrolling can get wrong, and
// because a pane that overflows its frame shows up as fused rows rather than as a wide line.
describe("MetaPane focused, stacked", () => {
  // 40 columns is 36 inside Panel's frame, which leaves 7 beside a card at MIN_TEXT_COLS — under
  // MIN_POSTER_COLS, so nothing can sit there and the pane stacks. 41 is the first width that can.
  const WIDE_W = 40;
  const FOCUSED_BUDGET = posterBudget(WIDE_W, INNER_ROWS, true);
  // What fitCells answers for a 2:3 poster in that budget (36x9): 12x9, narrowed by the rows the
  // card's guarantee kept back rather than by the pane's width.
  const FULL_ART = art(12, 9);

  const paneLines = (frame: string): string[] => frameLines(frame).slice(1, -1);
  const artRowCount = (frame: string): number =>
    paneLines(frame).filter((l) => l.includes("▀")).length;
  // Rows carrying card text: not the borders, not the art, not the blank spacer, and not the
  // scroll affordance, which is chrome the guarantee does not count.
  const cardRowCount = (frame: string): number =>
    paneLines(frame).filter(
      (l) =>
        !l.includes(ICON.up) &&
        !l.includes(ICON.down) &&
        l.replace(/[│▀\s]/g, "") !== "",
    ).length;

  // Swapping the row under a mounted pane, which a second render cannot express: the reset is an
  // effect keyed on the row, so the tree has to stay alive across the change. Mirrors the
  // setter-through-a-ref pattern Results.test.tsx uses for the query.
  let swapRow: ((r: TorrentResult) => void) | null = null;
  function Swappable() {
    const [row, setRow] = useState(ROW);
    useEffect(() => {
      swapRow = setRow;
      return () => {
        swapRow = null;
      };
    }, []);
    return <MetaPane result={row} width={WIDE_W} height={PANE_H} poster focused />;
  }

  it("asks for art sized to leave the card the rows it is guaranteed", () => {
    renderUI(
      <MetaPane result={ROW} width={WIDE_W} height={PANE_H} poster focused />,
    ).unmount();
    expect(FOCUSED_BUDGET).not.toBeNull();
    // Stacked, the art still gets every column inside Panel's frame — it is height it gives up.
    expect(FOCUSED_BUDGET?.cols).toBe(WIDE_W - 4);
    // The eight rows the card is promised, plus the spacer and the scroll affordance, neither of
    // which is card. A picture that filled the pane would bury the description the user focused
    // the pane to read, and the rows past what fits are the ones scrolling gives back anyway.
    expect(FOCUSED_BUDGET?.rows).toBe(INNER_ROWS - MIN_FOCUSED_TEXT_ROWS - 2);
    expect(mockPoster).toHaveBeenCalledWith(
      META.posterUrl,
      FOCUSED_BUDGET?.cols,
      FOCUSED_BUDGET?.rows,
      true,
    );
  });

  it("wears the focus the results panel gives up", () => {
    mockPoster.mockReturnValue({ loading: false, cells: FULL_ART });
    const ui = renderUI(<MetaPane result={ROW} width={WIDE_W} height={PANE_H} poster focused />);
    expect(ui.rawFrame()).toContain(ACCENT);
    ui.unmount();
  });

  it("keeps the description on screen under the art instead of a row of title", () => {
    // The whole point of the guarantee: a poster the user has to scroll past before reaching the
    // synopsis is not what they focused the pane for. Eight rows of card, art and all.
    mockMeta.mockReturnValue({ loading: false, meta: META_PLOT });
    mockPoster.mockReturnValue({ loading: false, cells: FULL_ART });
    const ui = renderUI(<MetaPane result={ROW} width={WIDE_W} height={PANE_H} poster focused />, {
      cols: 60,
    });
    const out = frameLines(ui.frame());

    expect(artRowCount(ui.frame())).toBe(FULL_ART.rows);
    expect(cardRowCount(ui.frame())).toBeGreaterThanOrEqual(MIN_FOCUSED_TEXT_ROWS);
    expect(ui.frame()).toContain("The Matrix");
    expect(ui.frame()).toContain("A computer hacker");
    expect(ui.frame()).toContain(`${ICON.down} more`);
    expect(ui.frame()).not.toContain(ICON.up);
    expect(out).toHaveLength(1 + PANE_H);
    for (const line of out) expect(displayWidth(line)).toBe(WIDE_W);
    ui.unmount();
  });

  it("scrolls the card under the window and clamps at the bottom", async () => {
    mockMeta.mockReturnValue({ loading: false, meta: META_PLOT });
    mockPoster.mockReturnValue({ loading: false, cells: FULL_ART });
    const ui = renderUI(<MetaPane result={ROW} width={WIDE_W} height={PANE_H} poster focused />, {
      cols: 60,
    });

    ui.press("j");
    await vi.waitFor(() => expect(ui.frame()).toContain(`${ICON.up}${ICON.down} more`));
    // One row of art gone from the top, and the card one row further along at the bottom.
    expect(artRowCount(ui.frame())).toBe(FULL_ART.rows - 1);

    // Ten presses for an overflow of four, so the last six are keys that do nothing rather than a
    // card that keeps sliding.
    for (let i = 0; i < 10; i++) ui.press(DOWN);
    await vi.waitFor(() => expect(ui.frame()).toContain(`${ICON.up} more`));

    const out = frameLines(ui.frame());
    expect(out).toHaveLength(1 + PANE_H);
    for (const line of out) expect(displayWidth(line)).toBe(WIDE_W);
    // The bottom of the card: the last words of the plot, which only exist on screen because the
    // focused planner was handed an infinite budget and never truncated it.
    expect(ui.frame()).toContain("power.");
    expect(ui.frame()).not.toContain(`${ICON.down} more`);

    ui.press("k");
    await vi.waitFor(() => expect(ui.frame()).toContain(`${ICON.up}${ICON.down} more`));
    ui.unmount();
  });

  it("pages by a window at a time and stops at the top", async () => {
    mockMeta.mockReturnValue({ loading: false, meta: META_PLOT });
    mockPoster.mockReturnValue({ loading: false, cells: FULL_ART });
    const ui = renderUI(<MetaPane result={ROW} width={WIDE_W} height={PANE_H} poster focused />, {
      cols: 60,
    });

    ui.press(PAGE_DOWN);
    await vi.waitFor(() => expect(ui.frame()).toContain("power."));
    ui.press(PAGE_UP);
    await vi.waitFor(() => expect(ui.frame()).toContain(`${ICON.down} more`));
    // Clamped, not wrapped: the first row of the card is back and nothing sits above it, so
    // every row of the art is on screen again.
    expect(ui.frame()).not.toContain(ICON.up);
    expect(artRowCount(ui.frame())).toBe(FULL_ART.rows);
    ui.unmount();
  });

  it("ignores movement keys while it does not hold the keyboard", async () => {
    mockPoster.mockReturnValue({ loading: false, cells: FULL_ART });
    // Unfocused the same pane draws the small art the row budget allows, and j belongs to the
    // list — a pane that scrolled from here would be stealing the cursor's key.
    const ui = renderUI(<MetaPane result={ROW} width={WIDE_W} height={PANE_H} poster />, {
      cols: 60,
    });
    const before = ui.frame();
    ui.press("j");
    ui.press(DOWN);
    await new Promise((r) => setTimeout(r, 20));
    expect(ui.frame()).toBe(before);
    ui.unmount();
  });

  it("opens a new row at the top of its card", async () => {
    mockMeta.mockReturnValue({ loading: false, meta: META_PLOT });
    mockPoster.mockReturnValue({ loading: false, cells: FULL_ART });
    const ui = renderUI(<Swappable />, { cols: 60 });

    ui.press(PAGE_DOWN);
    await vi.waitFor(() => expect(ui.frame()).toContain(`${ICON.up} more`));
    // A different release is a different card, and arriving at it halfway down would be reading
    // the middle of something the user has not seen the top of.
    swapRow?.({ ...ROW, infoHash: "h-beta" });
    await vi.waitFor(() => expect(ui.frame()).toContain(`${ICON.down} more`));
    expect(ui.frame()).not.toContain(ICON.up);
    ui.unmount();
  });

  it("leaves a card that already fits alone", () => {
    // No plot on this fixture: nine rows of art, the spacer and six of card in nineteen rows.
    // Nothing overflows, so there is no affordance and no row spent on one.
    mockPoster.mockReturnValue({ loading: false, cells: FULL_ART });
    const ui = renderUI(<MetaPane result={ROW} width={WIDE_W} height={PANE_H} poster focused />, {
      cols: 60,
    });
    expect(ui.frame()).toContain("Cast Keanu Reeves");
    expect(ui.frame()).not.toContain("more");
    const out = frameLines(ui.frame());
    expect(out).toHaveLength(1 + PANE_H);
    for (const line of out) expect(displayWidth(line)).toBe(WIDE_W);
    ui.unmount();
  });

  it("holds its frame on a pane too short for art at all", () => {
    // Five inner rows: posterBudget refuses art rather than break the card's guarantee, so this is
    // the text card alone with the whole pane to itself — which is the guarantee holding, not
    // failing.
    mockPoster.mockReturnValue({ loading: false, cells: FULL_ART });
    const ui = renderUI(<MetaPane result={ROW} width={WIDE_W} height={6} poster focused />, {
      cols: 60,
    });
    const out = frameLines(ui.frame());
    expect(out).toHaveLength(1 + 6);
    for (const line of out) expect(displayWidth(line)).toBe(WIDE_W);
    expect(ui.frame()).not.toContain("▀");
    expect(ui.frame()).toContain("The Matrix");
    ui.unmount();
  });
});

// The focused pane's second layout: poster in the left column, card in the right one. It exists
// because a poster fitCells had to cap by rows comes back narrower than the pane, and stacking
// spends the pane's whole height on the picture while leaving those freed columns as dead gutter
// beside it. Every assertion here is about which rows carry both things at once.
describe("MetaPane side by side", () => {
  // 60 columns is 56 inside Panel's frame, and 18 rows leave 17 inner ones. The art is handed
  // 56 - COLUMN_GAP - MIN_TEXT_COLS = 27 columns and all 17 rows, and a 2:3 poster fills 23x17 of
  // that box, leaving the card 32.
  const SPLIT_W = 60;
  const SPLIT_H = 18;
  const ART_COLS = 23;
  const ART_ROWS = 17;
  // The narrowest pane that splits at all: 41 is 37 inside the frame, which is MIN_POSTER_COLS +
  // COLUMN_GAP + MIN_TEXT_COLS exactly. 40 is one column short and stacks.
  const EDGE_W = 41;

  // The decoder's own answer for a 2:3 poster in whatever budget the pane asks for, rather than a
  // grid pinned to one size: the split is decided from the width fitCells narrows a height-capped
  // poster to, so a fixture that ignored that narrowing would only ever exercise one layout.
  const fitted = (): void => {
    mockPoster.mockImplementation((_url, cols, rows, enabled) => {
      if (!enabled || cols < 1 || rows < 1) return { loading: false, cells: null };
      const f = fitCells(120, 180, cols, rows);
      if (f.cols < 1 || f.rows < 1) return { loading: false, cells: null };
      return { loading: false, cells: art(f.cols, f.rows) };
    });
  };

  const paneLines = (frame: string): string[] => frameLines(frame).slice(1, -1);
  const artRowCount = (frame: string): number =>
    paneLines(frame).filter((l) => l.includes("▀")).length;
  // A row carrying art and text at once is the whole claim of this layout, and the one thing the
  // stacked layout can never produce.
  const beside = (frame: string, text: string): boolean =>
    paneLines(frame).some((l) => l.includes("▀") && l.includes(text));

  const intact = (ui: { frame: () => string }, w: number, h: number): void => {
    const out = frameLines(ui.frame());
    expect(out).toHaveLength(1 + h);
    for (const line of out) expect(displayWidth(line)).toBe(w);
  };

  it("puts the card beside the poster instead of under it", () => {
    fitted();
    const ui = renderUI(
      <MetaPane result={ROW} width={SPLIT_W} height={SPLIT_H} poster focused />,
      { cols: 100 },
    );
    // The art keeps the pane's whole height — beside the card it never had to give rows up — and
    // the title sits on its first row rather than seventeen rows below it.
    expect(artRowCount(ui.frame())).toBe(ART_ROWS);
    expect(beside(ui.frame(), "The Matrix")).toBe(true);
    expect(beside(ui.frame(), "Cast Keanu Reeves")).toBe(true);
    expect(paneLines(ui.frame())[0]).toContain("\u2580".repeat(ART_COLS));
    intact(ui, SPLIT_W, SPLIT_H);
    ui.unmount();
  });

  it("stacks one column below the width a picture needs beside the card, with no off-by-one", () => {
    fitted();
    // 37 inner columns: MIN_POSTER_COLS beside the gap and MIN_TEXT_COLS, so the pane splits on
    // the narrowest picture it is willing to draw.
    const wide = renderUI(
      <MetaPane result={ROW} width={EDGE_W} height={SPLIT_H} poster focused />,
      { cols: 100 },
    );
    expect(beside(wide.frame(), "The Matrix")).toBe(true);
    intact(wide, EDGE_W, SPLIT_H);
    wide.unmount();

    // 36: one column short, and the answer is the stacked layout rather than a seven-column smear
    // beside the card. The art gives up rows instead, and nothing sits next to it.
    const narrow = renderUI(
      <MetaPane result={ROW} width={EDGE_W - 1} height={SPLIT_H} poster focused />,
      { cols: 100 },
    );
    expect(narrow.frame()).toContain("\u2580");
    expect(beside(narrow.frame(), "The Matrix")).toBe(false);
    intact(narrow, EDGE_W - 1, SPLIT_H);
    narrow.unmount();
  });

  it("leaves an unfocused pane stacked however wide it is", () => {
    // Browsing, the pane is pinned at its tier's width and the card is cut to the rows the art
    // left — splitting there would hand both halves something too narrow to be either.
    fitted();
    const ui = renderUI(<MetaPane result={ROW} width={SPLIT_W} height={SPLIT_H} poster />, {
      cols: 100,
    });
    expect(ui.frame()).toContain("\u2580");
    expect(beside(ui.frame(), "The Matrix")).toBe(false);
    intact(ui, SPLIT_W, SPLIT_H);
    ui.unmount();
  });

  it("scrolls both columns as one list, not two", async () => {
    // The narrowest split, where the card is at MIN_TEXT_COLS and a full synopsis genuinely runs
    // past the window — so there is something below the fold in both columns at once.
    mockMeta.mockReturnValue({ loading: false, meta: META_PLOT });
    fitted();
    const ui = renderUI(<MetaPane result={ROW} width={EDGE_W} height={14} poster focused />, {
      cols: 100,
    });
    expect(beside(ui.frame(), "The Matrix")).toBe(true);
    expect(ui.frame()).toContain(`${ICON.down} more`);
    const before = artRowCount(ui.frame());
    // Where the card's own column starts, which must not move: a column that resized mid-scroll
    // would rewrap text planPaneLines had already wrapped to a width the window was sized for.
    const dirColumn = (frame: string): number =>
      paneLines(frame).find((l) => l.includes("Dir Lana"))?.indexOf("Dir Lana") ?? -1;
    const column = dirColumn(ui.frame());
    // Past the art, not merely somewhere: this pane is narrower, so its poster is narrower than
    // SPLIT_W's and the card starts wherever fitCells left off rather than at a fixed column.
    const artWidth = (paneLines(ui.frame())[0] ?? "").match(/\u2580+/)?.[0].length ?? 0;
    expect(artWidth).toBeGreaterThan(0);
    expect(column).toBeGreaterThan(artWidth);

    ui.press(DOWN);
    // One row off the top of *both* columns: the title has gone with the first row of art, which
    // is the property a second, independent scroller would break.
    await vi.waitFor(() => expect(ui.frame()).toContain(`${ICON.up}${ICON.down} more`));
    expect(artRowCount(ui.frame())).toBe(before - 1);
    expect(ui.frame()).not.toContain("The Matrix");
    expect(dirColumn(ui.frame())).toBe(column);
    intact(ui, EDGE_W, 14);
    ui.unmount();
  });

  // The sweep SWEEP_MS was chosen for: every width the pane can be given, against every height.
  it("holds its frame across the widths and heights either layout can land on", () => {
    fitted();
    for (let w = 34; w <= 90; w += 2) {
      for (let h = 6; h <= 22; h++) {
        const ui = renderUI(<MetaPane result={ROW} width={w} height={h} poster focused />, {
          cols: 100,
        });
        const out = frameLines(ui.frame());
        expect(out, `${w}x${h}`).toHaveLength(1 + h);
        for (const line of out) expect(displayWidth(line), `${w}x${h} "${line}"`).toBe(w);
        ui.unmount();
      }
    }
  }, SWEEP_MS);
});
