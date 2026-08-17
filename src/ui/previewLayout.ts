/**
 * How the results view splits its content width between the list and the info pane beside it.
 *
 * The pane is a bonus, never a cost: the list keeps a usable width at every tier and the pane
 * simply stops existing below the width where it would start eating into that. Mirrors
 * helpLayout.ts — a pure module that measures a layout so both the component and its tests read
 * the same numbers from one place.
 */

import { fitCells } from "../meta/image";

/**
 * The narrowest list worth rendering, derived from the columns the list already has: gutter 2 +
 * num 2 + 1 + name (min 18) + 1 + size 10 + 1 + seed 9 + 1 + src 4 = 49, plus Panel's own frame
 * of 4. Below this the name column — the only one that flexes — starts truncating release names
 * to the point where the list stops answering the question the user is scrolling it to answer.
 */
export const MIN_LIST_WIDTH = 52;

/** One blank column between the list panel and the pane, so their borders never touch. */
export const PANE_GAP = 1;

/** Panel's own frame around whatever it holds: a 1-column border and 1 column of padding a side. */
const PANE_FRAME = 4;

/**
 * Widest the card is ever wrapped to, in terminal columns.
 *
 * This bounds the *text measure*, not the pane. Prose past the mid-fifties stops being comfortable
 * — the eye loses the line it is returning to on the wrap — so 56 columns is where the card stops
 * getting wider however many columns the terminal has. It is still nearly twice the 30 the widest
 * browsing tier gives it.
 *
 * The distinction matters because the pane is not always just a card. Stacked, the pane *is* the
 * text column and 56 + PANE_FRAME = 60 is the whole pane, which is what this number used to say
 * outright. Side by side the text is only part of the width, so a 60-column cap on the pane caps
 * the card at roughly `60 - artCols - COLUMN_GAP` — 15 columns or fewer at a 120-column terminal,
 * which forced the stacked layout at exactly the sizes the split was built for. Bounding the
 * measure instead lets the pane grow to `artCols + COLUMN_GAP + this`, and not one column past it:
 * every column beyond goes back to the list, which does have a use for them.
 */
export const MAX_TEXT_COLS = 56;

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
 * everything above MIN_LIST_WIDTH — up to what the pane can actually spend, past which it has
 * nothing left to do with a column and the list keeps it. Both answers come out of the same tier
 * table, and both keep `list + PANE_GAP + pane === contentWidth`. At contentWidth 73 — the bottom
 * of the narrowest tier, where the list is already at MIN_LIST_WIDTH — there is nothing to give and
 * focusing changes no widths at all, which is the honest outcome rather than a pane that grows by
 * starving the list.
 *
 * "What the pane can spend" is where `paneInnerRows` comes in, and why a width function takes a
 * height at all: a focused pane that will seat its card *beside* the poster needs room for both,
 * and how wide the poster comes out is a question about the pane's height, not its width — a
 * height-capped poster is narrowed by fitCells to keep its aspect. Callers that have no pane yet
 * (App only asks whether one exists) can leave it out; the answer is then the stacked width, which
 * is the width a pane with no art gets anyway.
 */
export function previewLayout(
  contentWidth: number,
  focused = false,
  paneInnerRows = 0,
): PreviewLayout | null {
  const tier = TIERS.find((t) => contentWidth >= t.min);
  if (tier === undefined) return null;
  const laid = (pane: number): PreviewLayout => ({
    pane,
    list: contentWidth - pane - PANE_GAP,
    poster: tier.poster,
  });
  if (!focused) return laid(tier.pane);

  const spare = contentWidth - PANE_GAP - MIN_LIST_WIDTH;
  // The outer max is a floor, not a second opinion: focusing may only ever widen the pane, so no
  // focused width is worse than the browsing width it replaced, whatever the cap says.
  const grant = (cap: number): number => Math.max(tier.pane, Math.min(cap, spare));

  // What a poster of the usual shape comes out at when it has this pane's whole height and no
  // width worth mentioning to fight over — the number the side-by-side layout has to seat a card
  // next to. Width is deliberately unbounded here (contentWidth is only a sane ceiling): the point
  // is to ask the height what it wants before deciding how wide the pane must be to grant it.
  const art = tier.poster ? fitCells(POSTER_W, POSTER_H, contentWidth, paneInnerRows) : { cols: 0 };
  const wide = grant(art.cols + COLUMN_GAP + MAX_TEXT_COLS + PANE_FRAME);
  // Granted only if the extra columns actually become card beside the picture. Where the list
  // cannot spare that many, a wider pane would be a wider *stacked* pane — the card capped at
  // MAX_TEXT_COLS with dead columns beside it — so the stacked width is the honest answer and the
  // list keeps the difference.
  return laid(
    art.cols > 0 && seatsCardBeside(wide - PANE_FRAME, paneInnerRows)
      ? wide
      : grant(MAX_TEXT_COLS + PANE_FRAME),
  );
}

/**
 * Rows of card a focused pane guarantees on screen without scrolling.
 *
 * This is the contract the whole focused mode exists to keep: the user stepped into the pane to
 * *read the description*, so a poster they have to scroll past before reaching one is not serving
 * them. Six of these rows are the card's identity block — title, year·rating·runtime, genres,
 * director, and a cast credit that wraps to two lines at every width the pane is ever drawn at.
 * The remaining two are plot, which at 28 to 56 columns is 60 to 110 characters: a whole sentence
 * of synopsis, which is the difference between knowing a description exists and being able to read
 * one. Anything less and the guarantee buys only the title the pane already showed unfocused.
 *
 * It replaces an earlier two-row peek, which predated the pane carrying a plot at all and bought
 * exactly the title and nothing under it.
 */
export const MIN_FOCUSED_TEXT_ROWS = 8;

/**
 * What the art actually gives up in the stacked layout: the guaranteed card rows plus the two rows
 * of chrome around them that are not card — the blank spacer between the picture and the text, and
 * the one-line scroll affordance a pane with anything off screen spends a row on.
 */
const FOCUSED_TEXT_RESERVE = MIN_FOCUSED_TEXT_ROWS + 2;

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
 * The same floor read off the other axis. A 2:3 poster eight cells wide is six cells tall, so this
 * and MIN_POSTER_ROWS describe one smallest acceptable picture rather than two independent limits —
 * which is what lets the focused budget cap the art by width without needing a second opinion on
 * whether what is left is still worth drawing.
 */
const MIN_POSTER_COLS = 8;

/**
 * The rendition the Amazon host serves, and the shape every width below is reasoned in. Every
 * rendition shares its 2:3 ratio, so `fitCells` doesn't care which one actually decoded.
 */
export const POSTER_W = 120;
export const POSTER_H = 180;

/**
 * Whether a focused pane of these dimensions seats its card beside the poster rather than under it.
 *
 * The decision is made here, once, from dimensions alone — before any pixel is fetched — because
 * two things downstream have to agree on it and cannot ask each other: previewLayout has to know
 * how wide to make the pane, and posterBudget has to know which axis the art gives up. Deciding it
 * from the art that came back instead would make the pane's width depend on a decode that depends
 * on the pane's width.
 */
function seatsCardBeside(inner: number, paneInnerRows: number): boolean {
  return paneInnerRows >= MIN_POSTER_ROWS && inner - COLUMN_GAP - MIN_TEXT_COLS >= MIN_POSTER_COLS;
}

/**
 * The cell budget for poster art, or null when the pane has no room worth spending on it.
 * Returning null drops the art and keeps the facts, which is the right trade on a short terminal —
 * the pane exists to say what a release is, and it can do that in text alone.
 *
 * Unfocused, the art gets the pane's full inner width and bids against the text for a fixed set of
 * rows, winning the slack: it takes everything the facts card does not claim, so a taller pane
 * grows the picture first.
 *
 * Focused, the card's share is guaranteed rather than left over, and the only question is which
 * axis the art surrenders it on:
 *
 * - Wide enough to seat the card beside the picture, and the art gives up *columns*: it keeps the
 *   pane's entire height and hands back exactly the gutter MIN_TEXT_COLS needs. This is what makes
 *   the side-by-side layout affordable at every width that can hold it at all — capping the art by
 *   height instead would let a tall terminal grow the poster until nothing could fit next to it,
 *   which is precisely how a 120-column terminal ended up stacked with one row of text.
 * - Otherwise the art gives up *rows*, FOCUSED_TEXT_RESERVE of them, and the card sits underneath.
 *
 * Either way the guarantee holds: beside the art the card's column runs the pane's full height, and
 * under it the reserve is what the art was not allowed to take.
 *
 * MIN_POSTER_ROWS and MIN_POSTER_COLS veto the rest: below them the art is more artifact than
 * image and the cells are worth more to the facts.
 *
 * fitCells does the aspect arbitration from here; these are only the outer bounds it fits into, so
 * a poster narrower or shorter than the box simply comes back that way.
 *
 * `paneInnerRows` is the pane's content height (Panel's height less the border row it draws
 * inside it), not its outer height. The widths handed back are already inside Panel's frame.
 */
export function posterBudget(
  paneWidth: number,
  paneInnerRows: number,
  focused = false,
): { cols: number; rows: number } | null {
  const inner = paneWidth - PANE_FRAME;
  // Unreachable through previewLayout (its narrowest tier is 20 wide and carries no poster
  // anyway), but this is exported and a negative cell budget is not an answer.
  if (inner < 1) return null;
  if (focused && seatsCardBeside(inner, paneInnerRows)) {
    return { cols: inner - COLUMN_GAP - MIN_TEXT_COLS, rows: paneInnerRows };
  }
  const rows = paneInnerRows - (focused ? FOCUSED_TEXT_RESERVE : TEXT_ROWS);
  if (rows < MIN_POSTER_ROWS) return null;
  return { cols: inner, rows };
}

/**
 * One blank column between the poster and the card beside it.
 *
 * Same value and the same reason as PANE_GAP between the two panels: the art's last cell is a
 * saturated background colour, and a glyph sitting directly against it reads as being *on* the
 * picture. One column is enough to break that, and at these widths a second is a column the plot
 * wants more than the gutter does.
 */
export const COLUMN_GAP = 1;

/**
 * The narrowest card column worth splitting the focused pane into.
 *
 * The plot sets this floor: it is the widest thing the card holds and the only field with no
 * natural length, so it is what a bad measure ruins. The widest browsing tier — a 34-column pane —
 * already wraps that same plot at 30 columns inside Panel's frame, and that is the measure the
 * card was written against. 28 sits two columns under it: close enough that focusing never hands
 * the synopsis a worse line than browsing already did, and low enough that the split still engages
 * on a terminal someone plausibly has rather than being a feature nobody's screen can reach.
 * Under it a wrapped synopsis averages fewer than five words a line and the eye starts losing its
 * place on the return — which is the exact failure this layout exists to fix, so a pane that
 * cannot clear the bar stacks instead of splitting badly.
 */
export const MIN_TEXT_COLS = 28;

/**
 * Card columns for a focused pane laying the poster and the text side by side, or null when it
 * cannot afford to and should stack them the way it always has.
 *
 * `artCols` is the art's *natural* width at this pane's height, read off the grid that actually
 * decoded rather than off the budget it was decoded into: fitCells narrows a poster it had to cap
 * by rows to keep its aspect, and the columns that narrowing frees are precisely the empty gutter
 * this layout reclaims. A pane with no art on screen has nothing to sit beside and gets null.
 */
export function splitTextCols(innerWidth: number, artCols: number): number | null {
  if (artCols < 1) return null;
  const textCols = innerWidth - artCols - COLUMN_GAP;
  return textCols >= MIN_TEXT_COLS ? textCols : null;
}
