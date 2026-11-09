import { decode } from "jpeg-js";
import { fetchResilient, HttpError, USER_AGENT } from "../util/net";

// Cover art drawn as text: every cell is "▀" with the foreground painting the
// upper pixel and the background the lower one. A terminal cell is about twice
// as tall as wide, so one cell = two stacked square pixels. Needs a truecolor
// terminal, which every modern one is.

export interface Pixels {
  width: number;
  height: number;
  // RGBA, row-major
  data: Uint8Array;
}

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const MAX_ENTRIES = 64;
const HALF = "▀";
const RESET = "\x1b[0m";

// Largest grid that fits maxCols x maxRows and keeps the image's aspect ratio.
export function fitCells(
  imgW: number,
  imgH: number,
  maxCols: number,
  maxRows: number,
): { cols: number; rows: number } {
  let cols = Math.max(1, maxCols);
  let rows = Math.max(1, Math.round((cols * imgH) / imgW / 2));
  if (rows > maxRows) {
    rows = Math.max(1, maxRows);
    cols = Math.max(1, Math.min(maxCols, Math.round((rows * 2 * imgW) / imgH)));
  }
  return { cols, rows };
}

// Box-averages the source pixels that fall under one output pixel.
function average(img: Pixels, x0: number, x1: number, y0: number, y1: number): string {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      r += img.data[i]!;
      g += img.data[i + 1]!;
      b += img.data[i + 2]!;
      n++;
    }
  }
  n = Math.max(1, n);
  return `${Math.round(r / n)};${Math.round(g / n)};${Math.round(b / n)}`;
}

function span(i: number, outSize: number, inSize: number): [number, number] {
  const a = Math.floor((i * inSize) / outSize);
  const b = Math.floor(((i + 1) * inSize) / outSize);
  return [Math.min(a, inSize - 1), Math.max(a + 1, Math.min(b, inSize))];
}

export function toHalfBlocks(img: Pixels, cols: number, rows: number): string[] {
  const pxRows = rows * 2;
  const xs = Array.from({ length: cols }, (_, x) => span(x, cols, img.width));
  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    const [t0, t1] = span(row * 2, pxRows, img.height);
    const [b0, b1] = span(row * 2 + 1, pxRows, img.height);
    let line = "";
    for (const [x0, x1] of xs) {
      const top = average(img, x0, x1, t0, t1);
      const bottom = average(img, x0, x1, b0, b1);
      line += `\x1b[38;2;${top}m\x1b[48;2;${bottom}m${HALF}`;
    }
    lines.push(line + RESET);
  }
  return lines;
}

export function decodeCover(buf: Uint8Array): Pixels {
  const img = decode(buf, {
    useTArray: true,
    formatAsRGBA: true,
    maxResolutionInMP: 40,
    maxMemoryUsageInMB: 256,
  });
  return { width: img.width, height: img.height, data: img.data };
}

async function download(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const res = await fetchResilient(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    retries: 1,
  });
  if (!res.ok) throw new HttpError(res.status, `cover returned ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("cover too large");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("cover too large");
  return buf;
}

// Decoded covers by URL. A cover that can't be fetched or decoded (a dead
// host, a PNG/WebP) is remembered as null so scrolling past it again doesn't
// refetch it.
const cache = new Map<string, Pixels | null>();

function remember(url: string, img: Pixels | null): void {
  cache.delete(url);
  cache.set(url, img);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// Resolves to the decoded cover, or null when it can't be shown.
// Rejects only when aborted.
export async function loadPixels(url: string, signal: AbortSignal): Promise<Pixels | null> {
  let img = cache.get(url);
  if (img === undefined) {
    try {
      img = decodeCover(await download(url, signal));
    } catch (e) {
      if (signal.aborted) throw e;
      img = null;
    }
    remember(url, img);
  }
  return img;
}

export function clearCoverCache(): void {
  cache.clear();
}
