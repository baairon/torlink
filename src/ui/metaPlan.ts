/**
 * The detail panel's metadata rows: which of the five fields fit in a fixed row budget.
 *
 * A pure module the component and its tests both read from, mirroring paneCard.ts — the same
 * budgeted-degradation problem, one level down. paneCard.ts plans the *pane's* card; this plans
 * the *detail panel's* rows.
 */

import { ellipsizeToWidth, wordWrapLines } from "./textWidth";
import type { Meta } from "../meta/types";

export interface MetaPlan {
  readonly rating: string | null;
  readonly genres: string | null;
  readonly director: string | null;
  readonly cast: string | null;
  readonly plot: string | null;
}

export const NO_META_PLAN: MetaPlan = {
  rating: null,
  genres: null,
  director: null,
  cast: null,
  plot: null,
};

/**
 * Decides which of the five metadata rows fit in `budget` terminal rows, in priority order —
 * rating, genres, director, cast, plot — so a tight panel sheds value from the metadata block
 * outward and never touches the torrent facts above it or the action hint below.
 *
 * Rating/genres/director/cast share one cutoff: the moment a *present* row among them fails to
 * fit, every one of them considered afterward is dropped too, even ones that would individually
 * have fit on their own — otherwise a wide-but-short row (say, three-name Director) could land
 * after a taller one it just displaced (six-genre Genres), which reads as a row missing from the
 * middle of that group rather than a clean cut at its end. A field that is simply absent from this
 * title's metadata (no director credited, most series) is not a fit failure and never triggers
 * that cutoff — only a row that exists but does not fit does. Among themselves, genres/director/
 * cast are also all-or-nothing: a cast list cut off mid-name reads as a bug, not a feature, so
 * each is only admitted if every one of its wrapped lines fits.
 *
 * Plot is deliberately exempt from that cutoff and always evaluated last, spending whatever
 * budget the rows above it left unclaimed — whether they used it in full or gave up on it early —
 * and ellipsizing its last visible line when the full text still does not fit. This is the one
 * place a real gap can appear: rating can end up directly above plot with genres, director and
 * cast all missing between them. That is an accepted tradeoff, not an oversight — capping the
 * plot, rather than truncating whichever all-or-nothing row happens to sit at the budget boundary,
 * is the chosen primary lever for a tight panel, and plot is the only row built to show less than
 * it has.
 */
export function planMetaRows(meta: Meta | null, valueWidth: number, budget: number): MetaPlan {
  if (meta === null) return NO_META_PLAN;
  let remaining = budget;
  // Set the first time a present row does not fit. Every row considered afterward — regardless
  // of whether it would individually fit in what is left — is dropped, which is what keeps
  // degradation a clean prefix cut instead of a hole partway through the block.
  let cutoff = false;

  const admit = (rows: number): boolean => {
    if (cutoff || rows > remaining) {
      cutoff = true;
      return false;
    }
    remaining -= rows;
    return true;
  };

  const rating = meta.rating && admit(1) ? `${meta.rating} / 10` : null;

  const admitJoined = (values: readonly string[]): string | null => {
    if (values.length === 0) return null; // absent, not a fit failure — does not trip the cutoff
    const lines = wordWrapLines(values.join(", "), valueWidth);
    return admit(lines.length) ? lines.join("\n") : null;
  };

  const genres = admitJoined(meta.genres);
  const director = admitJoined(meta.director);
  const cast = admitJoined(meta.cast);

  // Not gated on `cutoff` — see the doc comment above for why plot is the deliberate exception.
  let plot: string | null = null;
  if (meta.plot && remaining > 0) {
    const lines = wordWrapLines(meta.plot, valueWidth);
    if (lines.length <= remaining) {
      plot = lines.join("\n");
    } else {
      const kept = lines.slice(0, remaining);
      const lastIndex = kept.length - 1;
      const last = kept[lastIndex];
      // A hard-wrapped chunk is already sized to fit exactly, so it never looks "cut" on its own
      // even though real text still follows it — the ellipsis has to be forced on here, or a
      // capped plot reads as the whole plot rather than a fragment of one.
      if (last !== undefined) {
        kept[lastIndex] = ellipsizeToWidth(last, valueWidth);
      }
      plot = kept.join("\n");
    }
  }

  return { rating, genres, director, cast, plot };
}
