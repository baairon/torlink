/**
 * How the results view splits its content width between the list and the info pane beside it.
 *
 * The pane is a bonus, never a cost: the list keeps a usable width at every tier and the pane
 * simply stops existing below the width where it would start eating into that. Mirrors
 * helpLayout.ts — a pure module that measures a layout so both the component and its tests read
 * the same numbers from one place.
 */

/**
 * The narrowest list worth rendering, derived from the columns the list already has: gutter 2 +
 * num 2 + 1 + name (min 18) + 1 + size 10 + 1 + seed 9 + 1 + src 4 = 49, plus Panel's own frame
 * of 4. Below this the name column — the only one that flexes — starts truncating release names
 * to the point where the list stops answering the question the user is scrolling it to answer.
 */
export const MIN_LIST_WIDTH = 52;

/** One blank column between the list panel and the pane, so their borders never touch. */
export const PANE_GAP = 1;

export interface PreviewLayout {
  pane: number;
  list: number;
  poster: boolean;
}

/**
 * Fixed pane widths, widest tier first. The pane is what is pinned and the list takes whatever is
 * left, rather than the other way round: a card whose width drifts with the terminal would rewrap
 * its title on every resize, while a list is built to absorb width through the name column's
 * `flexGrow`. Each tier's minimum leaves the list at exactly MIN_LIST_WIDTH or better — 34+1+65,
 * 28+1+57, 20+1+52 — which is the property previewLayout.test.ts pins.
 *
 * The 20-column tier drops the poster: 16 usable columns of art is a smear, but the same 16
 * columns still carry a title, a year and a genre list, which is the whole point of the pane.
 */
const TIERS: readonly { readonly min: number; readonly pane: number; readonly poster: boolean }[] = [
  { min: 100, pane: 34, poster: true },
  { min: 86, pane: 28, poster: true },
  { min: 73, pane: 20, poster: false },
];

/**
 * The split for a given content width, or null when the terminal is too narrow to hold both — in
 * which case the caller renders the list alone at full width. Auto-hiding rather than shrinking
 * is deliberate: an 80-column terminal is the floor torlink targets, and at that size the list is
 * already spending every column it has.
 */
export function previewLayout(contentWidth: number): PreviewLayout | null {
  const tier = TIERS.find((t) => contentWidth >= t.min);
  if (tier === undefined) return null;
  return { pane: tier.pane, list: contentWidth - tier.pane - PANE_GAP, poster: tier.poster };
}

/** Widest poster the pane will draw, in terminal columns. */
const POSTER_MAX_COLS = 24;

/**
 * Rows the text card always claims: title, year·rating·runtime, genres, director, two cast lines
 * and the blank spacer between the art and the text.
 */
const TEXT_ROWS = 7;

/**
 * Below this the art is more artifact than image, and the rows are worth more to the facts.
 */
const MIN_POSTER_ROWS = 6;

/**
 * The cell budget left for poster art after the text card has taken its rows, or null when the
 * pane is too short to draw anything worth drawing. Returning null drops the art and keeps the
 * facts, which is the right trade on a short terminal — the pane exists to say what a release is,
 * and it can do that in text alone.
 *
 * `paneInnerRows` is the pane's content height (Panel's height less the border row it draws
 * inside it), not its outer height. Exported for Task 6's poster rendering; the widths it hands
 * back are already inside Panel's frame.
 */
export function posterBudget(
  paneWidth: number,
  paneInnerRows: number,
): { cols: number; rows: number } | null {
  const inner = paneWidth - 4; // Panel's frame: border 2 + paddingX 2
  const cols = Math.min(inner, POSTER_MAX_COLS);
  const rows = paneInnerRows - TEXT_ROWS;
  // The `cols` guard is unreachable through previewLayout (its narrowest tier is 20 wide and
  // carries no poster anyway), but this is exported and a negative cell budget is not an answer.
  if (rows < MIN_POSTER_ROWS || cols < 1) return null;
  return { cols, rows };
}
