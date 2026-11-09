import { describe, expect, it } from "vitest";
import { encodeSixel, fitPixels, quantize, resize } from "./sixel";
import type { Pixels } from "./cover";

const image = (width: number, height: number, rgb: (x: number, y: number) => number[]): Pixels => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgb(x, y);
      data.set([r!, g!, b!, 255], (y * width + x) * 4);
    }
  return { width, height, data };
};

describe("fitPixels", () => {
  it("keeps the aspect ratio inside the box", () => {
    expect(fitPixels(150, 200, 260, 400)).toEqual({ w: 260, h: 346 });
    expect(fitPixels(150, 200, 260, 200)).toEqual({ w: 150, h: 200 });
  });
});

describe("resize", () => {
  it("averages blocks of pixels", () => {
    const img = image(2, 2, (x) => (x === 0 ? [0, 0, 0] : [200, 100, 50]));
    const out = resize(img, 1, 1);
    expect([...out.data]).toEqual([100, 50, 25, 255]);
  });
});

describe("quantize", () => {
  it("keeps distinct colours apart", () => {
    const img = image(4, 1, (x) => [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]][x]!);
    const { palette, index } = quantize(img);
    expect(new Set(index).size).toBe(4);
    expect(palette[index[0]!]).toEqual([255, 0, 0]);
  });

  it("never exceeds the colour limit", () => {
    const img = image(64, 64, (x, y) => [x * 4, y * 4, (x + y) * 2]);
    expect(quantize(img, 16).palette.length).toBeLessThanOrEqual(16);
  });
});

describe("encodeSixel", () => {
  it("frames the image with its size and a palette", () => {
    const out = encodeSixel(image(3, 7, () => [255, 0, 0]));
    expect(out.startsWith('\x1bP0;1;0q"1;1;3;7#0;2;100;0;0')).toBe(true);
    expect(out.endsWith("\x1b\\")).toBe(true);
  });

  it("packs six rows per band with run-length runs", () => {
    // 7 rows: one full band (all six bits = "~") and one with only the top bit ("@").
    const out = encodeSixel(image(5, 7, () => [0, 0, 0]));
    expect(out).toContain("#0!5~-#0!5@-");
  });
});
