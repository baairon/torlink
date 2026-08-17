import { describe, expect, it, beforeEach, vi } from "vitest";
import { MetaPane } from "./MetaPane";
import { renderUI } from "../testHarness";
import { displayWidth } from "../textWidth";
import { posterBudget } from "../previewLayout";
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

function art(cols: number, rows: number): PosterCells {
  return {
    cols,
    rows,
    lines: Array.from({ length: rows }, () => [{ fg: "#ff0000", bg: "#0000ff", n: cols }]),
  };
}

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
