/**
 * The info pane's text card: which lines a row's metadata wants and which of them fit.
 *
 * A pure module the component and its tests both read from, mirroring previewLayout.ts and
 * helpLayout.ts — the row arithmetic is the part most worth pinning without a render, and the
 * previews script needs the same card the app draws rather than a hand-rolled second copy of it.
 */

import { ellipsizeToWidth, wordWrapLines } from "./textWidth";
import { ICON } from "./theme";
import type { Meta } from "../meta/types";

/** Cast credits worth the rows in a pane this narrow; past the fourth name nobody is reading. */
export const CAST_SHOWN = 4;

/**
 * A row's text card: which lines it wants, in the order it wants them, already wrapped.
 *
 * `title` is the one line rendered in full colour; everything under it is dim, so the pane reads
 * as one quiet block the eye can skip rather than a second thing competing with the list.
 *
 * `text` is one block, newlines and all, until the pane flattens it: scrolling counts rows, and a
 * three-line cast credit is three rows to a window that has to cut between them.
 */
export interface PaneLine {
  readonly key: string;
  readonly text: string;
  readonly tone: "title" | "dim";
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `1994 · 8.7 · 142 min`, with whatever Cinemeta actually sent. */
function factsLine(meta: Meta): string {
  return [meta.year, meta.rating, meta.runtime]
    .filter((v): v is string => v !== undefined && v !== "")
    .join(` ${ICON.dot} `);
}

/** `S03E07 · Winter Is Coming` — only when the release named an episode we resolved. */
function episodeLine(meta: Meta): string {
  const ep = meta.episode;
  if (ep === undefined) return "";
  const code = `S${pad2(ep.season)}E${pad2(ep.number)}`;
  return ep.title ? `${code} ${ICON.dot} ${ep.title}` : code;
}

/**
 * Two lists of names in a row are indistinguishable without a word saying which is which, and the
 * pane has no room for a label column like the detail view's. The tag rides inside the wrapped
 * text so it is measured with it, not added to a line already sized to fit.
 */
function tagged(tag: string, values: readonly string[]): string {
  return values.length === 0 ? "" : `${tag} ${values.join(", ")}`;
}

/**
 * Which lines of the card fit in `budget` terminal rows, wrapped to `width` display columns.
 *
 * Same contract as the detail panel's planMetaRows, for the same reason: the pane has a fixed
 * height and Ink clips an overflowing box by squeezing rows through Yoga's shrink math, which
 * drops and fuses lines anywhere in the block rather than cutting the one that overflowed. Every
 * line is therefore admitted only once its wrapped height is known.
 *
 * The title is capped rather than dropped — it is the line that says *which* work this is, so a
 * pane with room for one row spends it there. Everything after it shares one cutoff: the first
 * present line that does not fit ends the card, so a short pane degrades as a clean cut at the
 * bottom instead of a hole in the middle. A field Cinemeta simply did not send (no director for
 * most series, no runtime for plenty of titles) is absent, not a fit failure, and never triggers
 * that cutoff.
 *
 * A focused pane passes an infinite budget: it scrolls, so nothing is competing for rows and the
 * whole card is built, with the window — not this function — deciding what is on screen.
 */
export function planPaneLines(meta: Meta, width: number, budget: number): PaneLine[] {
  const out: PaneLine[] = [];
  if (budget <= 0) return out;
  let remaining = budget;
  let cutoff = false;

  const titleLines = wordWrapLines(meta.title, width);
  if (titleLines.length > 0) {
    const kept = titleLines.slice(0, remaining);
    if (titleLines.length > remaining) {
      const lastIndex = kept.length - 1;
      const last = kept[lastIndex];
      // A wrapped line fills its width exactly, so a capped title reads as the whole title
      // unless the ellipsis is forced onto it.
      if (last !== undefined) kept[lastIndex] = ellipsizeToWidth(last, width);
      cutoff = true;
    }
    remaining -= kept.length;
    out.push({ key: "title", text: kept.join("\n"), tone: "title" });
  }

  const admit = (key: string, text: string): void => {
    if (cutoff || text === "") return;
    const lines = wordWrapLines(text, width);
    if (lines.length === 0) return;
    if (lines.length > remaining) {
      cutoff = true;
      return;
    }
    remaining -= lines.length;
    out.push({ key, text: lines.join("\n"), tone: "dim" });
  };

  admit("facts", factsLine(meta));
  // Directly under the title, not at the end of the card: on a series row the episode is half of
  // what identifies the release, and the shared cutoff means whatever sits last is the first
  // thing a short pane gives up.
  admit("episode", episodeLine(meta));
  admit("genres", meta.genres.join(", "));
  admit("director", tagged("Dir", meta.director));
  admit("cast", tagged("Cast", meta.cast.slice(0, CAST_SHOWN)));
  return out;
}
