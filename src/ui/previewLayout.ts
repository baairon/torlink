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

/**
 * Widest the focused pane will grow to, in terminal columns.
 *
 * Past this the pane gains nothing it can spend: the art is capped at POSTER_MAX_COLS (24) however
 * wide the pane gets, and a text measure past the mid-fifties stops helping — the eye loses the
 * line it is returning to. 60 columns is 56 inside Panel's frame, which is a comfortable measure
 * and still twice the widest tier's 30. Every column past it goes back to the list, which does
 * have a use for them: at contentWidth 160 the list keeps 99 and stops truncating release names
 * instead of the pane holding 64 blank columns beside a 24-column poster.
 */
const FOCUSED_PANE_MAX = 60;

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
 *
 * `focused` is the pane holding the keyboard, which reverses who gets the spare columns: browsing,
 * the list absorbs them and the pane stays pinned so its card never rewraps under the cursor;
 * reading, the user has said the pane is what they are looking at, so the list gives back
 * everything above MIN_LIST_WIDTH — up to FOCUSED_PANE_MAX, past which the pane has nothing left
 * to spend the columns on and the list keeps them. Both answers come out of the same tier table,
 * and both keep `list + PANE_GAP + pane === contentWidth`. At contentWidth 73 — the bottom of the
 * narrowest tier, where the list is already at MIN_LIST_WIDTH — there is nothing to give and
 * focusing changes no widths at all, which is the honest outcome rather than a pane that grows by
 * starving the list.
 */
export function previewLayout(contentWidth: number, focused = false): PreviewLayout | null {
  const tier = TIERS.find((t) => contentWidth >= t.min);
  if (tier === undefined) return null;
  // The outer max is a floor, not a second opinion: focusing may only ever widen the pane, so no
  // focused width is worse than the browsing width it replaced, whatever the cap says.
  const pane = focused
    ? Math.max(tier.pane, Math.min(FOCUSED_PANE_MAX, contentWidth - PANE_GAP - MIN_LIST_WIDTH))
    : tier.pane;
  return { pane, list: contentWidth - pane - PANE_GAP, poster: tier.poster };
}

/** Widest poster the pane will draw, in terminal columns. */
const POSTER_MAX_COLS = 24;

/**
 * Rows per column of art the focused pane will allow, as a ceiling and not a target.
 *
 * fitCells is width-first, so a poster only ever asks for `cols * imgH / (imgW * 2)` rows — 18 for
 * a 2:3 poster at 24 columns, which is the size the art was always meant to be. This number exists
 * for the pathological shape (a 1:6 banner served as a poster) that would otherwise scroll for
 * pages, and 2 is already twice as tall as any real poster gets.
 */
const FOCUSED_ROWS_PER_COL = 2;

/**
 * Rows the art gives up to the text below it: the facts card at its usual height — title,
 * year·rating·runtime, genres, director, two cast lines — plus the blank spacer between the art
 * and the text.
 *
 * Not an enumeration of every field the card can hold. The plot has no natural length and is
 * planned last against whatever the facts underspent, so it claims what is left of these seven
 * rather than asking for rows of its own; a pane whose credits wrap short simply shows more of it.
 */
const TEXT_ROWS = 7;

/**
 * Below this the art is more artifact than image, and the rows are worth more to the facts.
 */
const MIN_POSTER_ROWS = 6;

/**
 * The cell budget for poster art, or null when the pane has no room worth spending on it.
 * Returning null drops the art and keeps the facts, which is the right trade on a short terminal —
 * the pane exists to say what a release is, and it can do that in text alone.
 *
 * Unfocused the art bids against the text for a fixed set of rows, so it gets what the text card
 * leaves and MIN_POSTER_ROWS vetoes the rest. Focused the pane scrolls, which is what this whole
 * mode is for: the rows stop being the constraint, the art is sized from the width alone, and the
 * text simply sits below however far down that puts it. The veto still applies to the *pane*
 * rather than to the budget — a pane with fewer rows on screen than MIN_POSTER_ROWS would open on
 * a wall of art with the facts several keypresses away, which is not reading, it is hunting.
 *
 * `paneInnerRows` is the pane's content height (Panel's height less the border row it draws
 * inside it), not its outer height. The widths handed back are already inside Panel's frame.
 */
export function posterBudget(
  paneWidth: number,
  paneInnerRows: number,
  focused = false,
): { cols: number; rows: number } | null {
  const inner = paneWidth - 4; // Panel's frame: border 2 + paddingX 2
  const cols = Math.min(inner, POSTER_MAX_COLS);
  // Unreachable through previewLayout (its narrowest tier is 20 wide and carries no poster
  // anyway), but this is exported and a negative cell budget is not an answer.
  if (cols < 1) return null;
  if (focused) {
    if (paneInnerRows < MIN_POSTER_ROWS) return null;
    return { cols, rows: cols * FOCUSED_ROWS_PER_COL };
  }
  const rows = paneInnerRows - TEXT_ROWS;
  if (rows < MIN_POSTER_ROWS) return null;
  return { cols, rows };
}
