import type { Region } from "./store";

/**
 * Where the cursor lands after the list identity changes under it (a source
 * streaming in mid-search, a sort cycle, the z filter). Follows the row the
 * user selected by infohash; a user who never navigated stays pinned to the
 * top so the best result keeps the pointer as arrivals reshuffle the order.
 */
export function stickCursor(
  results: readonly { infoHash: string }[],
  selected: string | null,
  cursor: number,
): number {
  if (!selected) return 0;
  const idx = results.findIndex((r) => r.infoHash === selected);
  if (idx >= 0) return idx;
  return Math.min(cursor, Math.max(0, results.length - 1));
}

export function wrapStep(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (((current + delta) % length) + length) % length;
}

export function windowStart(cursor: number, total: number, height: number): number {
  if (total <= height) return 0;
  const half = Math.floor(height / 2);
  return Math.max(0, Math.min(cursor - half, total - height));
}

/**
 * First visible row of a block the user scrolls directly, clamped to both ends.
 *
 * Not windowStart: that one centres a cursor, and a scrolled pane has no cursor — the offset *is*
 * the state the keys move, so it must stay put when the content around it grows (a poster landing)
 * or shrinks (a resize) rather than re-centring on something. Clamping here rather than at the
 * keypress is what keeps a held-down arrow key from banking scroll it cannot spend.
 */
export function scrollStart(start: number, total: number, height: number): number {
  if (total <= height) return 0;
  return Math.max(0, Math.min(start, total - height));
}

/**
 * The columns the arrow keys walk, left to right. "help" is deliberately absent: it is a modal
 * flag, not a place, and stepping out of a modal is the modal's own job.
 */
const COLUMNS: readonly Region[] = ["sidebar", "content", "preview"];

/**
 * The region one step left (-1) or right (+1) of `region`, clamped at both ends — no wrap, so the
 * ends of the row are dead keys rather than a jump across the screen.
 *
 * `previewOpen` is what keeps focus off a pane that is not on screen: with it false the walk stops
 * at "content" in both directions, which also rescues focus that was already inside the pane when
 * it disappeared (a resize below the split's width, the `i` toggle, a section without metadata).
 */
export function stepRegion(region: Region, step: -1 | 1, previewOpen: boolean): Region {
  const at = COLUMNS.indexOf(region);
  if (at < 0) return region;
  const last = previewOpen ? COLUMNS.length - 1 : COLUMNS.indexOf("content");
  return COLUMNS[Math.min(last, Math.max(0, at + step))] ?? region;
}

/**
 * Outer height of the results panel given the body's row budget.
 *
 * The results view stacks a search bar (`searchH` rows) + a one-row gap on top
 * of the panel. We intentionally subtract one extra row so the view never
 * *exactly* fills the parent `overflow: "hidden"` body box. An exact fit
 * desyncs Ink's incremental terminal renderer and makes it swallow a row while
 * scrolling — the "highlighted numbering is wrong" bug (issue #21). Downloads
 * and Seeding already leave this slack via `listRows - 1`; this keeps Results
 * consistent with them.
 */
export function resultsPanelOuter(listRows: number, searchH: number): number {
  return Math.max(5, listRows - searchH - 2);
}
