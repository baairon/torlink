// Single source of truth for the animated progress-bar sheen, shared by the
// live TUI (src/ui/components/ProgressBar.tsx) and the README SVG generator
// (scripts/ansi-to-svg.ts) so the preview renders 1:1 with the terminal.
//
// The highlight is a cosine bell that sweeps across the filled cells. Position
// advances by a fractional SHEEN_SPEED per tick at a fast SHEEN_TICK_MS, so the
// peak glides between cells (intensity-interpolated) instead of stepping a whole
// cell at a time, while the cells themselves stay discrete (pixelated).

export const SHEEN_PEAK = "#f4efff";
export const SHEEN_RADIUS = 4.5; // bell half-width, in cells
export const SHEEN_GAP = 8; // dark cells between sweeps
export const SHEEN_TICK_MS = 40; // frame interval (~25fps)
export const SHEEN_SPEED = 0.45; // cells advanced per tick (~11 cells/sec)
export const SHEEN_MAX = 0.9; // peak blend toward SHEEN_PEAK

/** Total sweep cycle length in cells, for a bar `width` cells wide. */
export function sheenPeriod(width: number): number {
  return Math.ceil(width + SHEEN_RADIUS * 2) + SHEEN_GAP;
}

/** Fractional center of the bell at a given tick (loops over `period`). */
export function sheenCenter(tick: number, period: number): number {
  return ((tick * SHEEN_SPEED) % period) - SHEEN_RADIUS;
}

/** Sheen intensity (0..SHEEN_MAX) for cell `i` given the bell `center`. */
export function sheenIntensity(i: number, center: number): number {
  const d = Math.abs(i - center);
  if (d >= SHEEN_RADIUS) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * d) / SHEEN_RADIUS)) * SHEEN_MAX;
}

/** Ticks in one full visual loop, for sampling the SVG flipbook 1:1. */
export function sheenLoopTicks(period: number): number {
  return Math.round(period / SHEEN_SPEED);
}
