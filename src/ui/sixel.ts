import type { Pixels } from "./cover";

// Sixel: a real bitmap in the terminal. Windows Terminal (1.22+), like the
// VT340 it follows, lays images out on a virtual 10x20 px grid per cell and
// scales that to the font, so these are the pixel sizes to aim for.
export const CELL_W = 10;
export const CELL_H = 20;

const MAX_COLORS = 255;

// Box-filter resize to exactly w x h.
export function resize(img: Pixels, w: number, h: number): Pixels {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * img.width + sx) * 4;
          r += img.data[i]!;
          g += img.data[i + 1]!;
          b += img.data[i + 2]!;
          n++;
        }
      }
      data.set([r / n, g / n, b / n, 255], (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}

// Largest size inside maxW x maxH that keeps the aspect ratio.
export function fitPixels(imgW: number, imgH: number, maxW: number, maxH: number): { w: number; h: number } {
  const scale = Math.min(maxW / imgW, maxH / imgH);
  return { w: Math.max(1, Math.floor(imgW * scale)), h: Math.max(1, Math.floor(imgH * scale)) };
}

// Median cut: split the colour box with the widest channel at its median
// until there are MAX_COLORS boxes, then average each box. Returns the palette
// and each pixel's palette index.
export function quantize(img: Pixels, maxColors = MAX_COLORS): { palette: number[][]; index: Uint8Array } {
  const n = img.width * img.height;
  const px = (i: number, c: number): number => img.data[i * 4 + c]!;
  type Bucket = { items: Uint32Array; channel: number; range: number };
  const measure = (items: Uint32Array): Bucket => {
    const lo = [255, 255, 255], hi = [0, 0, 0];
    for (const i of items)
      for (let c = 0; c < 3; c++) {
        const v = px(i, c);
        if (v < lo[c]!) lo[c] = v;
        if (v > hi[c]!) hi[c] = v;
      }
    const ranges = [0, 1, 2].map((c) => hi[c]! - lo[c]!);
    const channel = ranges.indexOf(Math.max(...ranges));
    return { items, channel, range: ranges[channel]! };
  };

  const buckets: Bucket[] = [measure(Uint32Array.from({ length: n }, (_, i) => i))];
  // Weighting the range by pixel count spends colours where the picture has
  // area (a sky gradient) rather than on a handful of outlier pixels.
  const score = (b: Bucket): number => (b.items.length > 1 ? b.range * b.items.length : 0);
  while (buckets.length < maxColors) {
    let pick = -1;
    for (let b = 0; b < buckets.length; b++)
      if (score(buckets[b]!) > 0 && (pick < 0 || score(buckets[b]!) > score(buckets[pick]!))) pick = b;
    if (pick < 0) break;
    const { items, channel } = buckets[pick]!;
    const sorted = items.slice().sort((a, b) => px(a, channel) - px(b, channel));
    const mid = sorted.length >> 1;
    buckets.splice(pick, 1, measure(sorted.subarray(0, mid)), measure(sorted.subarray(mid)));
  }

  const palette: number[][] = [];
  const index = new Uint8Array(n);
  buckets.forEach((bucket, k) => {
    const sum = [0, 0, 0];
    for (const i of bucket.items) {
      for (let c = 0; c < 3; c++) sum[c]! += px(i, c);
      index[i] = k;
    }
    palette.push(sum.map((s) => Math.round(s / bucket.items.length)));
  });
  return { palette, index };
}

function runLength(bits: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bits.length) {
    const v = bits[i]!;
    let j = i + 1;
    while (j < bits.length && bits[j] === v) j++;
    const ch = String.fromCharCode(63 + v);
    const run = j - i;
    out += run > 3 ? `!${run}${ch}` : ch.repeat(run);
    i = j;
  }
  return out;
}

export function encodeSixel(img: Pixels): string {
  const { width: w, height: h } = img;
  const { palette, index } = quantize(img);
  let out = `\x1bP0;1;0q"1;1;${w};${h}`;
  palette.forEach(([r, g, b], k) => {
    const pct = (v: number): number => Math.round((v * 100) / 255);
    out += `#${k};2;${pct(r!)};${pct(g!)};${pct(b!)}`;
  });
  for (let top = 0; top < h; top += 6) {
    const rows = Math.min(6, h - top);
    const bands = new Map<number, Uint8Array>();
    for (let dy = 0; dy < rows; dy++) {
      const base = (top + dy) * w;
      for (let x = 0; x < w; x++) {
        const k = index[base + x]!;
        let bits = bands.get(k);
        if (!bits) bands.set(k, (bits = new Uint8Array(w)));
        bits[x]! |= 1 << dy;
      }
    }
    const parts: string[] = [];
    for (const [k, bits] of bands) parts.push(`#${k}${runLength(bits)}`);
    out += parts.join("$") + "-";
  }
  return out + "\x1b\\";
}
