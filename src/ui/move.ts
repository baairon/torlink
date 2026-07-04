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
