import { useEffect, useState } from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { MetaPane } from "./MetaPane";
import { KEY, renderUI } from "../testHarness";
import { displayWidth } from "../textWidth";
import { posterBudget } from "../previewLayout";
import { ICON } from "../theme";
import { usePoster } from "../hooks/usePoster";
import { useResultMeta } from "../hooks/useResultMeta";
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

// The focused pane is the same card with the vertical budget taken off it: full-size art, the
// whole text, and a window over the two. Every assertion here is about rows — which ones are on
// screen and how many — because that is what scrolling can get wrong, and because a pane that
// overflows its frame shows up as fused rows rather than as a wide line.
describe("MetaPane focused", () => {
  // What the results view hands a focused pane at 120 columns: previewLayout gives the list its
  // MIN_LIST_WIDTH and the pane the rest.
  const WIDE_W = 42;
  const FOCUSED_BUDGET = posterBudget(WIDE_W, INNER_ROWS, true);
  // A 2:3 poster at the full 24 columns — the size the art was always meant to be and never
  // reached below a 44-row terminal, which is the measurement this whole mode exists for.
  const FULL_ART = art(24, 18);
  // 18 art rows + the spacer + this card's six text rows: title, facts, genres, director and a
  // cast credit that wraps to two at 38 columns inside the frame.
  const TOTAL_ROWS = 18 + 1 + 6;

  const paneLines = (frame: string): string[] => frameLines(frame).slice(1, -1);
  const artRowCount = (frame: string): number =>
    paneLines(frame).filter((l) => l.includes("▀")).length;

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

  it("asks for art sized by the pane's width, not by the rows the text left over", () => {
    renderUI(
      <MetaPane result={ROW} width={WIDE_W} height={PANE_H} poster focused />,
    ).unmount();
    expect(FOCUSED_BUDGET).not.toBeNull();
    expect(FOCUSED_BUDGET?.cols).toBe(24);
    // Taller than the pane on purpose: the height cap is a ceiling on pathological art, and the
    // rows it would not have fitted in are exactly the ones scrolling gives back.
    expect(FOCUSED_BUDGET?.rows).toBeGreaterThan(INNER_ROWS);
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

  it("fills the frame exactly with art it is too short to hold, and says there is more", () => {
    mockPoster.mockReturnValue({ loading: false, cells: FULL_ART });
    const ui = renderUI(<MetaPane result={ROW} width={WIDE_W} height={PANE_H} poster focused />, {
      cols: 60,
    });
    const out = frameLines(ui.frame());

    expect(out).toHaveLength(1 + PANE_H);
    for (const line of out) expect(displayWidth(line)).toBe(WIDE_W);
    // The affordance costs one row, so the window is one short of the pane's inner height.
    expect(artRowCount(ui.frame())).toBe(INNER_ROWS - 1);
    expect(ui.frame()).toContain(`${ICON.down} more`);
    expect(ui.frame()).not.toContain(ICON.up);
    // Off the bottom of the window, and not rendered anywhere above it.
    expect(ui.frame()).not.toContain("The Matrix");
    ui.unmount();
  });

  it("scrolls the card under the window and clamps at the bottom", async () => {
    mockPoster.mockReturnValue({ loading: false, cells: FULL_ART });
    const ui = renderUI(<MetaPane result={ROW} width={WIDE_W} height={PANE_H} poster focused />, {
      cols: 60,
    });

    ui.press("j");
    await vi.waitFor(() => expect(ui.frame()).toContain(`${ICON.up}${ICON.down} more`));
    // One row of art gone from the top, and the card one row further along at the bottom.
    expect(artRowCount(ui.frame())).toBe(INNER_ROWS - 2);

    // Six rows is the entire overflow: 24 rows of card into an 18-row window. Ten presses, so
    // the last four are keys that do nothing rather than a card that keeps sliding.
    for (let i = 0; i < 10; i++) ui.press(DOWN);
    await vi.waitFor(() => expect(ui.frame()).toContain(`${ICON.up} more`));

    const out = frameLines(ui.frame());
    expect(out).toHaveLength(1 + PANE_H);
    for (const line of out) expect(displayWidth(line)).toBe(WIDE_W);
    // The bottom of the card: title, credits, and the six rows of art that scrolled off the top.
    expect(ui.frame()).toContain("The Matrix");
    expect(ui.frame()).toContain("Dir Lana Wachowski");
    expect(ui.frame()).toContain("Cast Keanu Reeves");
    expect(ui.frame()).not.toContain(`${ICON.down} more`);
    expect(artRowCount(ui.frame())).toBe(FULL_ART.rows - (TOTAL_ROWS - (INNER_ROWS - 1)));

    ui.press("k");
    await vi.waitFor(() => expect(ui.frame()).toContain(`${ICON.up}${ICON.down} more`));
    ui.unmount();
  });

  it("pages by a window at a time and stops at the top", async () => {
    mockPoster.mockReturnValue({ loading: false, cells: FULL_ART });
    const ui = renderUI(<MetaPane result={ROW} width={WIDE_W} height={PANE_H} poster focused />, {
      cols: 60,
    });

    ui.press(PAGE_DOWN);
    await vi.waitFor(() => expect(ui.frame()).toContain("Cast Keanu Reeves"));
    ui.press(PAGE_UP);
    await vi.waitFor(() => expect(ui.frame()).toContain(`${ICON.down} more`));
    // Clamped, not wrapped: the first row of the card is back and nothing sits above it.
    expect(ui.frame()).not.toContain(ICON.up);
    expect(artRowCount(ui.frame())).toBe(INNER_ROWS - 1);
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
    // No art: five lines of text in nineteen rows. Nothing overflows, so there is no affordance
    // and no row spent on one.
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
    // rows 17: the shortest terminal the app still draws a results panel in. posterBudget refuses
    // art below MIN_POSTER_ROWS on screen, so this is the text card in a five-row window.
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
