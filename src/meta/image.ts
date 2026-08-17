import jpeg from "jpeg-js";

// Turning a JPEG into something a terminal can draw, with no terminal graphics protocol involved.
// Ink owns the screen and repaints whole frames through its own renderer, so a sixel or kitty
// escape written into a cell would be overwritten, mispositioned, or measured as text on the next
// repaint. Half-block characters are just text: they survive the renderer, they survive a resize,
// and they degrade on a 16-colour terminal without any code here knowing about it.
//
// Everything in this module is total. It runs from a React render path, so a truncated body, a
// WebP served with a .jpg name or a decoder that simply gives up must all come back as null.

/** Decoded pixels: RGBA, four bytes per pixel, row-major. The only image shape below the decoder. */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** `n` consecutive cells sharing one upper (`fg`) and lower (`bg`) colour, as `#rrggbb`. */
export interface PosterRun {
  readonly fg: string;
  readonly bg: string;
  readonly n: number;
}

export interface PosterCells {
  readonly cols: number;
  readonly rows: number;
  readonly lines: readonly (readonly PosterRun[])[];
}

/**
 * The same picture as text a graphics-capable terminal resolves into a real image.
 *
 * Deliberately the same shape as PosterCells — a cell grid whose rows are independent strings —
 * because that is what keeps the pane's scroll window a slice. Each line is a run of cells that
 * name their own row and column inside an image the terminal already holds, so row *i* of this
 * array is row *i* of the picture wherever it is drawn on screen: no placement to fix up, nothing
 * to re-encode when the window moves. `color` carries the image id in its 24 bits, which is how
 * the id reaches the terminal at all — it rides through Ink's own SGR rather than through an
 * escape Ink would strip.
 */
export interface GraphicsCells {
  readonly cols: number;
  readonly rows: number;
  readonly lines: readonly string[];
  readonly color: string;
  readonly imageId: number;
}

/** Either art shape. Every consumer past the decoder is written against this, not against one. */
export type PosterArt = PosterCells | GraphicsCells;

/**
 * Narrows on a field only one shape has. `in` rather than a `kind` tag so PosterCells stays
 * exactly the interface it already was — the cell grid is what four test files and the previews
 * script build by hand, and a discriminant added to it would be a discriminant added to all of
 * them.
 */
export function isGraphics(art: PosterArt): art is GraphicsCells {
  return "imageId" in art;
}

export function sliceArt(art: PosterCells, from: number, to: number): PosterCells;
export function sliceArt(art: GraphicsCells, from: number, to: number): GraphicsCells;
export function sliceArt(art: PosterArt, from: number, to: number): PosterArt;
/**
 * The rows of `art` between `from` and `to`, clamped to the art that exists.
 *
 * The one place the pane's scroll window is expressed, and the reason the poster scrolls *with*
 * the pane instead of hovering over it: art is text, a window into it is a slice of rows, and both
 * shapes answer that the same way. Written once against the union so a shape that scrolled by
 * some other mechanism could not be added without changing this function — the property holds by
 * construction rather than by whoever touches MetaPane next remembering it.
 *
 * Identity is preserved when the whole picture is inside the window, which is the common case:
 * Poster is memoised, and a fresh object every render would defeat that for the one thing in the
 * pane expensive enough to reconcile. An empty window comes back as zero rows rather than null —
 * "no rows visible" is a slice, not a failure, and the caller decides what to draw for it.
 */
export function sliceArt(art: PosterArt, from: number, to: number): PosterArt {
  const lo = Math.max(0, Math.min(Math.trunc(from), art.rows));
  const hi = Math.max(lo, Math.min(Math.trunc(to), art.rows));
  if (lo === 0 && hi === art.rows) return art;
  const rows = hi - lo;
  // Twice the same slice, because `lines` is a union of two array types and TypeScript will not
  // call `.slice` across one: each half of the union has a signature, and neither is assignable to
  // the other. Narrowing first is what makes both calls resolvable without a cast.
  if (isGraphics(art)) return { ...art, rows, lines: art.lines.slice(lo, hi) };
  return { ...art, rows, lines: art.lines.slice(lo, hi) };
}

// jpeg-js allocates the whole decoded frame before anything here gets to downsample it, so the
// only useful ceiling sits on the decoder. 32 MB is far above any poster rendition either host
// serves (120x180 decodes to 86 KB) and far below what a header claiming a 20000x20000 frame
// would want, which is the case this number exists for.
const MAX_DECODE_MB = 32;

/**
 * Cell dimensions for an image inside a `maxCols` x `maxRows` budget, preserving aspect.
 *
 * A half-block cell carries one pixel column and two pixel rows, and a terminal cell is itself
 * roughly twice as tall as it is wide, so those two factors cancel: the pixels come out square
 * when the cell grid is half as tall as the pixel grid. That makes a 2:3 poster `0.75 * cols`
 * rows — 24 columns of art is 18 rows, which is what the pane budgets for.
 *
 * Returns a zero budget rather than throwing for a degenerate image or a budget with no room in
 * it; `decodePoster` reads that as "no art", which is a rendering outcome, not an error.
 */
export function fitCells(
  imgW: number,
  imgH: number,
  maxCols: number,
  maxRows: number,
): { cols: number; rows: number } {
  const capCols = Math.floor(maxCols);
  const capRows = Math.floor(maxRows);
  if (!(imgW > 0) || !(imgH > 0) || capCols < 1 || capRows < 1) return { cols: 0, rows: 0 };

  // Width-first, because the pane pins the poster's width and has rows to spare; only a wide
  // image (or a short pane) ever trips the height cap below.
  let cols = capCols;
  let rows = Math.max(1, Math.round((cols * imgH) / (imgW * 2)));
  if (rows > capRows) {
    rows = capRows;
    cols = Math.min(capCols, Math.max(1, Math.round((rows * 2 * imgW) / imgH)));
  }
  return { cols, rows };
}

/**
 * Box-average `bmp` down to a `cols` x `pxRows` grid of RGB triples.
 *
 * A box average, not a nearest-neighbour pick: at these ratios (a 120x180 poster into 24x36
 * pixels) every output pixel covers ~25 input pixels, and sampling one of them turns film grain
 * and subtitle text into speckle. Averaging is also what makes the result stable — the same
 * poster at the same budget always produces the same bytes, which is what lets the hook cache it.
 */
export function sampleGrid(bmp: Bitmap, cols: number, pxRows: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, cols * pxRows * 3));
  if (cols < 1 || pxRows < 1 || bmp.width < 1 || bmp.height < 1) return out;

  for (let cy = 0; cy < pxRows; cy++) {
    const y0 = Math.floor((cy * bmp.height) / pxRows);
    // Upsampling (an image smaller than the grid asked for) gives a zero-width box, so every band
    // claims at least one source row. Without this a 2x2 poster stretched to 24 cells averages
    // nothing and comes out black.
    const y1 = Math.min(bmp.height, Math.max(y0 + 1, Math.floor(((cy + 1) * bmp.height) / pxRows)));
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx * bmp.width) / cols);
      const x1 = Math.min(bmp.width, Math.max(x0 + 1, Math.floor(((cx + 1) * bmp.width) / cols)));

      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * bmp.width;
        for (let x = x0; x < x1; x++) {
          const i = (row + x) * 4;
          // A short data array (a decoder that returned fewer bytes than its own header claims)
          // reads as black rather than NaN, so one malformed frame cannot poison a hex string.
          r += bmp.data[i] ?? 0;
          g += bmp.data[i + 1] ?? 0;
          b += bmp.data[i + 2] ?? 0;
          n++;
        }
      }

      const o = (cy * cols + cx) * 3;
      if (n > 0) {
        out[o] = Math.round(r / n);
        out[o + 1] = Math.round(g / n);
        out[o + 2] = Math.round(b / n);
      }
    }
  }
  return out;
}

function hex2(v: number): string {
  return v.toString(16).padStart(2, "0");
}

function colorAt(grid: Uint8Array, offset: number): string {
  return `#${hex2(grid[offset] ?? 0)}${hex2(grid[offset + 1] ?? 0)}${hex2(grid[offset + 2] ?? 0)}`;
}

/**
 * Fold `2 * rows` pixel rows into `rows` cell rows of `▀` runs: the upper pixel becomes the
 * foreground colour, the lower one the background.
 *
 * Runs are merged because the cost of this art is escape sequences, not characters. A poster's
 * letterbox bars, flat sky and dark background are long stretches of one colour pair, and emitting
 * them as one `<Text>` instead of twenty-four turns roughly 800 SGR switches per frame into well
 * under a hundred — the difference between a pane that repaints invisibly and one that tears while
 * the user holds an arrow key down.
 */
export function toHalfBlockLines(grid: Uint8Array, cols: number, rows: number): PosterRun[][] {
  const lines: PosterRun[][] = [];
  if (cols < 1 || rows < 1) return lines;

  for (let row = 0; row < rows; row++) {
    const upper = row * 2 * cols * 3;
    const lower = (row * 2 + 1) * cols * 3;
    const runs: PosterRun[] = [];

    for (let x = 0; x < cols; x++) {
      const fg = colorAt(grid, upper + x * 3);
      const lowOffset = lower + x * 3;
      // An odd pixel-row count leaves the last cell with no bottom half. Repeating the top pixel
      // renders it as a solid block; reading past the grid would paint a black bar under the image.
      const bg = lowOffset + 2 < grid.length ? colorAt(grid, lowOffset) : fg;

      const prev = runs[runs.length - 1];
      if (prev !== undefined && prev.fg === fg && prev.bg === bg) {
        runs[runs.length - 1] = { fg, bg, n: prev.n + 1 };
      } else {
        runs.push({ fg, bg, n: 1 });
      }
    }
    lines.push(runs);
  }
  return lines;
}

/**
 * JPEG bytes to drawable cells, or null for anything that is not a JPEG we can render.
 *
 * jpeg-js throws for a missing SOI, an unknown marker, a truncated scan and an over-budget frame
 * alike, and all of those mean the same thing here: draw the text card without art. Nothing is
 * rethrown, because the only caller is a React effect feeding a render.
 */
export function decodePoster(
  bytes: Uint8Array,
  maxCols: number,
  maxRows: number,
): PosterCells | null {
  try {
    const img = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: MAX_DECODE_MB });
    const { cols, rows } = fitCells(img.width, img.height, maxCols, maxRows);
    if (cols < 1 || rows < 1) return null;
    const grid = sampleGrid({ width: img.width, height: img.height, data: img.data }, cols, rows * 2);
    return { cols, rows, lines: toHalfBlockLines(grid, cols, rows) };
  } catch {
    return null;
  }
}
