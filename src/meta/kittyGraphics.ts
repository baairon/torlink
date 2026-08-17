import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { decodeBitmap, fitCells, sampleGrid } from "./image";

// The kitty graphics protocol, in the one dialect that survives Ink.
//
// Ink owns the screen and re-emits every frame through its own sanitizer, and that sanitizer
// (node_modules/ink/build/sanitize-ansi.js) re-emits only text, OSC and SGR CSI tokens: an APC
// image escape written into a cell is dropped outright, and a sixel DCS with it. What does survive
// is kitty's *Unicode placeholder* path, because it is text. A placeholder cell is U+10EEEE plus
// combining marks naming the row and column of an image the terminal already holds, and the image
// id rides in the foreground colour — an SGR Ink emits for us through chalk. Ink's own grapheme
// segmentation (Intl.Segmenter) then measures the whole cluster as one column, so the art occupies
// exactly `cols` cells and clips, slices and scrolls like any other text.
//
// The image bytes themselves cannot go through Ink at all; they are written straight to the
// stream, once, before the placeholders are painted (see writeChunks). Ink's eraseLines clears
// text, not kitty's image store — the store is keyed by image id and only an explicit delete
// empties it — so a transmit-only blob persists across repaints.

/** U+10EEEE. One of these plus its marks is one cell of picture. */
export const PLACEHOLDER = "\u{10EEEE}";

/**
 * kitty's row/column diacritics: index *i* is encoded by appending this code point.
 *
 * The list is every combining mark with canonical combining class 230 that takes no part in
 * canonical composition, in code point order — kitty's own derivation, and the reason a mark like
 * U+0301 (which composes into precomposed letters, so NFC could eat it) is absent while U+0305 is
 * first. kittyGraphics.test.ts re-derives exactly that rule from ICU and compares, so a
 * transcription slip fails a test rather than drawing a scrambled picture.
 *
 * Cut at U+082D on purpose. Everything above it in the class is a later Unicode addition, so a
 * kitty built against a different Unicode version could disagree with us about index 129 and up —
 * but never about 0 to 128, since additions land after U+082D in code point order and cannot
 * disturb the prefix. 129 rows and columns is far more picture than a terminal has room for; art
 * past it falls back to half-blocks rather than gambling on the tail of the table.
 */
const DIACRITICS: readonly number[] = [
  0x0305, 0x030d, 0x030e, 0x0310, 0x0312, 0x033d, 0x033e, 0x033f,
  0x0346, 0x034a, 0x034b, 0x034c, 0x0350, 0x0351, 0x0352, 0x0357,
  0x035b, 0x0363, 0x0364, 0x0365, 0x0366, 0x0367, 0x0368, 0x0369,
  0x036a, 0x036b, 0x036c, 0x036d, 0x036e, 0x036f, 0x0483, 0x0484,
  0x0485, 0x0486, 0x0487, 0x0592, 0x0593, 0x0594, 0x0595, 0x0597,
  0x0598, 0x0599, 0x059c, 0x059d, 0x059e, 0x059f, 0x05a0, 0x05a1,
  0x05a8, 0x05a9, 0x05ab, 0x05ac, 0x05af, 0x05c4, 0x0610, 0x0611,
  0x0612, 0x0613, 0x0614, 0x0615, 0x0616, 0x0617, 0x0657, 0x0658,
  0x0659, 0x065a, 0x065b, 0x065d, 0x065e, 0x06d6, 0x06d7, 0x06d8,
  0x06d9, 0x06da, 0x06db, 0x06dc, 0x06df, 0x06e0, 0x06e1, 0x06e2,
  0x06e4, 0x06e7, 0x06e8, 0x06eb, 0x06ec, 0x0730, 0x0732, 0x0733,
  0x0735, 0x0736, 0x073a, 0x073d, 0x073f, 0x0740, 0x0741, 0x0743,
  0x0745, 0x0747, 0x0749, 0x074a, 0x07eb, 0x07ec, 0x07ed, 0x07ee,
  0x07ef, 0x07f0, 0x07f1, 0x07f3, 0x0816, 0x0817, 0x0818, 0x0819,
  0x081b, 0x081c, 0x081d, 0x081e, 0x081f, 0x0820, 0x0821, 0x0822,
  0x0823, 0x0825, 0x0826, 0x0827, 0x0829, 0x082a, 0x082b, 0x082c,
  0x082d,
];

/** Rows and columns a placeholder image can address: the table's length, and a hard ceiling. */
export const MAX_PLACEHOLDER_CELLS = DIACRITICS.length;

/** The mark encoding row or column `i`, or null past the table. */
export function diacritic(i: number): string | null {
  const cp = DIACRITICS[i];
  return cp === undefined ? null : String.fromCodePoint(cp);
}

/**
 * `#rrggbb` carrying the low 24 bits of an image id.
 *
 * This is the whole reason the tier needs certain truecolour: Ink hands the colour to chalk, and a
 * chalk that downgrades it to the 256-colour palette does not fail — it names a *different* image
 * id, and the terminal draws whatever else happens to be under it, or nothing.
 */
export function idColor(id: number): string {
  return `#${(id & 0xffffff).toString(16).padStart(6, "0")}`;
}

/**
 * One string per cell row of a `cols` x `rows` picture, or null when it will not fit the table.
 *
 * Every cell carries *both* its row and its column mark. kitty allows omitting the column and
 * inferring it from the cell to the left, which would be a third shorter — but Panel clips
 * horizontally with sliceAnsi, and an inferred column decodes as the wrong slice of the image the
 * moment the left edge is cut. Spelling both out is what makes the art survive clipping by the
 * pane and slicing by the scroll window alike: every cell is self-describing, so any rectangle of
 * these cells still names the part of the picture it stands on.
 *
 * The id is not encoded in a third diacritic. kitty reads the high byte of the id from one, and
 * every id nextImageId hands out fits in the 24 bits the colour already carries.
 */
export function placeholderLines(id: number, cols: number, rows: number): readonly string[] | null {
  if (cols < 1 || rows < 1) return null;
  if (cols > MAX_PLACEHOLDER_CELLS || rows > MAX_PLACEHOLDER_CELLS) return null;
  const marks = DIACRITICS.map((cp) => String.fromCodePoint(cp));
  const columns = marks.slice(0, cols);
  // Indexed nowhere: sliced and mapped, so there is no element access to prove in range.
  return marks.slice(0, rows).map((row) => columns.map((col) => PLACEHOLDER + row + col).join(""));
}

// Ids cycle through the three colour bytes with none of them ever zero. A zero byte is the one
// value a terminal, a colour downgrade or a "default foreground" reading can silently swallow, and
// swallowing one byte of an id points the placeholders at some other image entirely.
let idCounter = 0;
const ID_BYTE_VALUES = 255;

// Every id handed out, in the order it was handed out. The terminal's image store keeps an image
// until something deletes it, so this list is what the store holds on our account, and the only
// handle teardown has on it. An id issued for a poster that never reached the wire — a picture past
// the diacritic table, a deflate that failed — is recorded too: deleting an id the store never held
// is a no-op, and over-naming our own ids is cheaper and safer than threading each transmission's
// outcome back here.
const issuedIds = new Set<number>();

/**
 * The next image id: unique for 255^3 posters, and never with a zero colour byte.
 *
 * Recorded as it is issued rather than as it is transmitted, because this is the one place every
 * id passes through — see deleteIssued.
 */
export function nextImageId(): number {
  const n = idCounter;
  idCounter = (idCounter + 1) % (ID_BYTE_VALUES * ID_BYTE_VALUES * ID_BYTE_VALUES);
  const r = 1 + (n % ID_BYTE_VALUES);
  const g = 1 + (Math.floor(n / ID_BYTE_VALUES) % ID_BYTE_VALUES);
  const b = 1 + Math.floor(n / (ID_BYTE_VALUES * ID_BYTE_VALUES));
  const id = (r << 16) | (g << 8) | b;
  issuedIds.add(id);
  return id;
}

/**
 * The escapes that drop this process's images, on the way out. Empty when there are none.
 *
 * One escape per id, and never the `d=A` that frees every image *in the terminal window*: that
 * store is shared with everything else drawn in that terminal, so a picture the user put there
 * before launching torlink has to still be there afterwards. Ours are named individually because
 * nothing else distinguishes them.
 *
 * `d=I` rather than `d=i` frees the image data as well as its placements; leaving the pixels behind
 * would grow the store for the rest of the terminal's life, which is the cost this exists to avoid.
 * `q=2` for the same reason every other escape here carries it — see transmitChunks.
 */
export function deleteIssued(): string {
  let out = "";
  for (const id of issuedIds) out += `\u001b_Ga=d,d=I,i=${id},q=2\u001b\\`;
  return out;
}

/** Pixels for one poster, already at the size the terminal will draw them. */
export interface GraphicsPoster {
  readonly cols: number;
  readonly rows: number;
  readonly pxW: number;
  readonly pxH: number;
  /** `pxW * pxH * 3` bytes, row-major RGB: exactly kitty's `f=24` payload. */
  readonly rgb: Uint8Array;
}

// Pixels per cell. A terminal cell is about twice as tall as it is wide, so these two keep the
// sampled pixels square — the same cancellation fitCells is built on, which is why the cell
// arithmetic below is the *same* arithmetic the half-block tier uses. 8x16 is roughly a normal
// terminal font at a normal size: fine enough that the poster reads as a photograph rather than
// as a mosaic, coarse enough that a full-height poster stays under the payload cap.
const CELL_PX_W = 8;
const CELL_PX_H = 16;

/**
 * Ceiling on the raw RGB a single poster may cost, before deflate.
 *
 * This is the SSH bill. Deflate is weak on photographs — a poster compresses to maybe two thirds —
 * so a megabyte of pixels is most of a megabyte on the wire, and it is spent again every time the
 * cursor settles on a new row. 1.2 MB covers every pane a terminal can actually show (a 53x40 cell
 * poster is 814 KB) and refuses the pathological ones, which fall back to half-blocks: coarser art
 * is a far better answer than a pane that stalls.
 */
const MAX_RAW_BYTES = 1_200_000;

/**
 * JPEG bytes to a picture at the pixel size a `maxCols` x `maxRows` cell budget will draw, or null
 * for anything that is not worth sending.
 *
 * Total, like decodePoster and for the same reason: every null here is answered by the half-block
 * tier, so a poster the graphics path refuses is still a poster on screen.
 */
export function decodeGraphicsPoster(
  bytes: Uint8Array,
  maxCols: number,
  maxRows: number,
): GraphicsPoster | null {
  const img = decodeBitmap(bytes);
  if (img === null) return null;
  const { cols, rows } = fitCells(img.width, img.height, maxCols, maxRows);
  if (cols < 1 || rows < 1) return null;
  if (cols > MAX_PLACEHOLDER_CELLS || rows > MAX_PLACEHOLDER_CELLS) return null;

  const pxW = cols * CELL_PX_W;
  const pxH = rows * CELL_PX_H;
  // Checked from the dimensions rather than from the sampled buffer: refusing after allocating
  // and filling a megabyte would pay the whole cost to decline it.
  if (pxW * pxH * 3 > MAX_RAW_BYTES) return null;

  return { cols, rows, pxW, pxH, rgb: sampleGrid(img, pxW, pxH) };
}

// kitty's own limit on one escape's payload. Chunks are base64, so this is a character count.
const MAX_CHUNK = 4096;

/**
 * The escapes that put `poster` in the terminal's image store under `id`.
 *
 * `a=T` transmits and displays in one go, `U=1` makes the placement virtual — the placeholders
 * below are what actually draw it — and `c`/`r` pin the cell footprint so the terminal scales the
 * pixels into exactly the cells the pane budgeted. `q=2` suppresses the terminal's acknowledgement,
 * which matters more than it sounds: the reply would arrive on stdin, where Ink's parse-keypress
 * would read it as keystrokes.
 *
 * `f=24,o=z` is raw RGB, deflated. kitty takes PNG or raw and not JPEG, a PNG encoder is a
 * dependency this repo will not take, and sampleGrid already emits precisely `pxW * pxH * 3`
 * row-major bytes — the payload format, arrived at for free.
 *
 * Total: a deflate that fails (out of memory, nothing else can) comes back as no chunks, which
 * every caller reads as "no picture to draw".
 */
export function transmitChunks(id: number, poster: GraphicsPoster): readonly string[] {
  // Deflating nothing still produces a zlib header, so the empty picture is refused here rather
  // than being sent as a valid transmission of no pixels.
  if (poster.rgb.length === 0) return [];
  let b64: string;
  try {
    b64 = Buffer.from(deflateSync(poster.rgb)).toString("base64");
  } catch {
    return [];
  }
  if (b64.length === 0) return [];

  const chunks: string[] = [];
  for (let at = 0; at < b64.length; at += MAX_CHUNK) {
    const part = b64.slice(at, at + MAX_CHUNK);
    const more = at + MAX_CHUNK < b64.length ? 1 : 0;
    // Control keys ride on the first chunk only; the rest carry the continuation flag alone,
    // which is what kitty expects and what keeps the tail of a big image cheap.
    const control =
      at === 0
        ? `a=T,U=1,q=2,i=${id},f=24,o=z,s=${poster.pxW},v=${poster.pxH},` +
          `c=${poster.cols},r=${poster.rows},m=${more}`
        : `m=${more}`;
    chunks.push(`\u001b_G${control};${part}\u001b\\`);
  }
  return chunks;
}

/**
 * Put the transmission on the stream. The only impure export here, and it never throws.
 *
 * One write, not one per chunk: Ink writes whole frames with single writes of its own, and a
 * transmission split across several would let a repaint land in the middle of an image and
 * corrupt both. Node orders writes on a stream, so a transmission written before the state update
 * that paints the placeholders is in the terminal's store before the placeholders reach the
 * screen.
 */
export function writeChunks(out: NodeJS.WriteStream, chunks: readonly string[]): void {
  if (chunks.length === 0) return;
  try {
    out.write(chunks.join(""));
  } catch {
    // A closed or broken stdout during teardown. There is no picture either way, and throwing out
    // of a render path is a crashed TUI.
  }
}
