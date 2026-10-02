import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { decodePoster, fitCells, sampleGrid, toHalfBlockLines } from "./image";
import type { Bitmap } from "./image";

// Two real JPEGs, inlined rather than committed as fixtures — the repo carries no binary files and
// a 400-byte constant is easier to reason about than one. They exist because the two poster hosts
// encode differently: m.media-amazon.com serves baseline, images.metahub.space serves progressive
// even when asked for `?format=jpeg`, and a decoder that only handles the first would silently
// lose every title that never went through the catalog.
//
// BASELINE_JPEG: 2x2, solid red, baseline.
const BASELINE_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgs" +
  "LEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB" +
  "QUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQA" +
  "QAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEA" +
  "AhEDEQA/ADoDFU3/2Q==";

// PROGRESSIVE_JPEG: 4x4, top two rows red and bottom two blue, progressive (multi-scan SOF2).
const PROGRESSIVE_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgs" +
  "LEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB" +
  "QUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wgARCAAEAAQDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABUBA" +
  "QEAAAAAAAAAAAAAAAAAAAUH/9oADAMBAAIQAxAAAAEKuCv/xAAWEAADAAAAAAAAAAAAAAAAAAAAAxT/2gAIAQEAAQUC" +
  "vef/xAAaEQAABwAAAAAAAAAAAAAAAAAAAgUWU6LS/9oACAEDAQE/AXetz1Jkf//EABoRAAAHAAAAAAAAAAAAAAAAAAA" +
  "CBRZUotL/2gAIAQIBAT8BZKBHsfQ//8QAFxAAAwEAAAAAAAAAAAAAAAAAAAEyof/aAAgBAQAGPwK8R//EABYQAAMAAA" +
  "AAAAAAAAAAAAAAAADR8P/aAAgBAQABPyGKj//aAAwDAQACAAMAAAAQ/wD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oAC" +
  "AEDAQE/EHH/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH3/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEB" +
  "AAE/ECH/2Q==";

const bytes = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, "base64"));

/** `#rrggbb` back to channels, so a decode can be asserted within a tolerance rather than exactly. */
function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// JPEG is lossy and the exact channel values depend on the decoder's IDCT, so colours are asserted
// as "unmistakably this hue", not as literals a jpeg-js patch release could shift by one.
function expectNear(hex: string, target: readonly [number, number, number], tol = 12): void {
  const got = rgb(hex);
  for (let i = 0; i < 3; i++) {
    expect(Math.abs((got[i] ?? -1) - (target[i] ?? 0)), `${hex} channel ${i}`).toBeLessThanOrEqual(
      tol,
    );
  }
}

/** RGBA bitmap from a list of RGB triples, row-major. */
function bitmap(width: number, height: number, px: readonly (readonly number[])[]): Bitmap {
  const data = new Uint8Array(width * height * 4);
  px.forEach((p, i) => {
    data[i * 4] = p[0] ?? 0;
    data[i * 4 + 1] = p[1] ?? 0;
    data[i * 4 + 2] = p[2] ?? 0;
    data[i * 4 + 3] = 255;
  });
  return { width, height, data };
}

describe("fitCells", () => {
  it("gives a 2:3 poster three quarters as many rows as columns", () => {
    // A half-block cell is 1px wide and 2px tall, and a terminal cell is about 1:2, so the pixels
    // come out square exactly here. 24 columns of a 120x180 poster is 18 rows.
    expect(fitCells(120, 180, 24, 20)).toEqual({ cols: 24, rows: 18 });
    expect(fitCells(1000, 1500, 24, 20)).toEqual({ cols: 24, rows: 18 });
  });

  it("takes the full width when the height budget allows it", () => {
    expect(fitCells(100, 100, 24, 20)).toEqual({ cols: 24, rows: 12 });
    expect(fitCells(400, 100, 24, 20)).toEqual({ cols: 24, rows: 3 });
  });

  it("falls back to the height budget and narrows the width to keep aspect", () => {
    // 24 columns would want 18 rows; a 13-row pane gets a 17-column poster instead of a squashed
    // 24-column one, because a stretched poster reads as a rendering bug.
    expect(fitCells(120, 180, 24, 13)).toEqual({ cols: 17, rows: 13 });
    expect(fitCells(120, 180, 24, 6)).toEqual({ cols: 8, rows: 6 });
  });

  it("never returns a budget larger than the one it was given", () => {
    for (const [w, h] of [
      [120, 180],
      [180, 120],
      [1, 400],
      [400, 1],
    ] as const) {
      const fit = fitCells(w, h, 24, 13);
      expect(fit.cols).toBeLessThanOrEqual(24);
      expect(fit.rows).toBeLessThanOrEqual(13);
      expect(fit.cols).toBeGreaterThanOrEqual(1);
      expect(fit.rows).toBeGreaterThanOrEqual(1);
    }
  });

  it("returns a zero budget rather than throwing on degenerate input", () => {
    expect(fitCells(0, 180, 24, 13)).toEqual({ cols: 0, rows: 0 });
    expect(fitCells(120, 0, 24, 13)).toEqual({ cols: 0, rows: 0 });
    expect(fitCells(120, 180, 0, 13)).toEqual({ cols: 0, rows: 0 });
    expect(fitCells(120, 180, 24, 0)).toEqual({ cols: 0, rows: 0 });
    expect(fitCells(Number.NaN, 180, 24, 13)).toEqual({ cols: 0, rows: 0 });
  });
});

describe("sampleGrid", () => {
  const K = [0, 0, 0];
  const W = [255, 255, 255];
  // 4x4 checkerboard of 2x2 blocks: black, white / white, black.
  const CHECKER = bitmap(4, 4, [K, K, W, W, K, K, W, W, W, W, K, K, W, W, K, K]);

  it("box-averages each cell over the pixels it covers", () => {
    // 2x2 output: every cell covers one whole 2x2 block, so the averages are the block colours.
    expect(Array.from(sampleGrid(CHECKER, 2, 2))).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0,
    ]);
  });

  it("averages across block boundaries when a cell straddles them", () => {
    // 1x2: each row of the grid covers all four columns of two source rows — two black and two
    // white pixels per band, so both come out mid-grey rather than picking a side.
    expect(Array.from(sampleGrid(CHECKER, 1, 2))).toEqual([128, 128, 128, 128, 128, 128]);
    // 1x1 collapses the whole image: eight black, eight white.
    expect(Array.from(sampleGrid(CHECKER, 1, 1))).toEqual([128, 128, 128]);
  });

  it("repeats source pixels rather than sampling nothing when upscaling", () => {
    const solid = bitmap(1, 1, [[10, 20, 30]]);
    expect(Array.from(sampleGrid(solid, 3, 2))).toEqual([
      10, 20, 30, 10, 20, 30, 10, 20, 30, 10, 20, 30, 10, 20, 30, 10, 20, 30,
    ]);
  });

  it("returns an empty grid for a degenerate request", () => {
    expect(sampleGrid(CHECKER, 0, 4)).toHaveLength(0);
    expect(sampleGrid(CHECKER, 4, 0)).toHaveLength(0);
    expect(Array.from(sampleGrid(bitmap(0, 0, []), 2, 2))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("toHalfBlockLines", () => {
  it("folds two pixel rows into one cell row, upper as fg and lower as bg", () => {
    // 2 cols x 2 pixel rows: top row red then green, bottom row blue then black.
    const grid = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]);
    expect(toHalfBlockLines(grid, 2, 1)).toEqual([
      [
        { fg: "#ff0000", bg: "#0000ff", n: 1 },
        { fg: "#00ff00", bg: "#000000", n: 1 },
      ],
    ]);
  });

  it("merges consecutive cells that share both colours", () => {
    // 4 cols x 2 pixel rows: red/blue, red/blue, red/blue, green/blue.
    const grid = new Uint8Array([
      255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255,
    ]);
    expect(toHalfBlockLines(grid, 4, 1)).toEqual([
      [
        { fg: "#ff0000", bg: "#0000ff", n: 3 },
        { fg: "#00ff00", bg: "#0000ff", n: 1 },
      ],
    ]);
  });

  it("emits one line per cell row and reads the right pixel rows for each", () => {
    // 1 col x 4 pixel rows: red, green, blue, white.
    const grid = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    expect(toHalfBlockLines(grid, 1, 2)).toEqual([
      [{ fg: "#ff0000", bg: "#00ff00", n: 1 }],
      [{ fg: "#0000ff", bg: "#ffffff", n: 1 }],
    ]);
  });

  it("repeats the upper pixel when a cell has no lower half", () => {
    // A grid one pixel row short: the bottom half would read past the end, and a black bar under
    // the image is a more visible bug than a solid last row.
    const grid = new Uint8Array([255, 0, 0]);
    expect(toHalfBlockLines(grid, 1, 1)).toEqual([[{ fg: "#ff0000", bg: "#ff0000", n: 1 }]]);
  });

  it("returns no lines for a degenerate budget", () => {
    expect(toHalfBlockLines(new Uint8Array(12), 0, 2)).toEqual([]);
    expect(toHalfBlockLines(new Uint8Array(12), 2, 0)).toEqual([]);
  });
});

describe("decodePoster", () => {
  it("decodes a baseline JPEG — the rendition m.media-amazon.com serves", () => {
    const cells = decodePoster(bytes(BASELINE_JPEG), 2, 1);
    expect(cells).not.toBeNull();
    expect(cells?.cols).toBe(2);
    expect(cells?.rows).toBe(1);
    const line = cells?.lines[0];
    // Solid red end to end, so the whole row merges into a single run.
    expect(line).toHaveLength(1);
    expect(line?.[0]?.n).toBe(2);
    expectNear(line?.[0]?.fg ?? "", [255, 0, 0]);
    expectNear(line?.[0]?.bg ?? "", [255, 0, 0]);
  });

  it("decodes a progressive JPEG — the rendition images.metahub.space serves", () => {
    const cells = decodePoster(bytes(PROGRESSIVE_JPEG), 4, 2);
    expect(cells).not.toBeNull();
    expect(cells?.cols).toBe(4);
    expect(cells?.rows).toBe(2);
    const [top, bottom] = cells?.lines ?? [];
    // The source is red over blue, one colour per half of the image; both halves of both cell rows
    // therefore land on their own colour, and each row merges to one run.
    expect(top).toHaveLength(1);
    expect(bottom).toHaveLength(1);
    expect(top?.[0]?.n).toBe(4);
    expectNear(top?.[0]?.fg ?? "", [255, 0, 0]);
    expectNear(top?.[0]?.bg ?? "", [255, 0, 0]);
    expectNear(bottom?.[0]?.fg ?? "", [0, 0, 255]);
    expectNear(bottom?.[0]?.bg ?? "", [0, 0, 255]);
  });

  it("fills the whole budget it is given", () => {
    const cells = decodePoster(bytes(PROGRESSIVE_JPEG), 24, 18);
    expect(cells?.cols).toBe(24);
    expect(cells?.rows).toBe(12); // square source, so half as many rows as columns
    expect(cells?.lines).toHaveLength(12);
    for (const line of cells?.lines ?? []) {
      expect(line.reduce((n, run) => n + run.n, 0)).toBe(24);
    }
  });

  it("returns null for bytes that are not a JPEG", () => {
    expect(decodePoster(new Uint8Array([1, 2, 3]), 24, 18)).toBeNull();
    expect(decodePoster(new Uint8Array(0), 24, 18)).toBeNull();
  });

  it("returns null for a truncated JPEG rather than throwing", () => {
    const full = bytes(PROGRESSIVE_JPEG);
    // Header intact, scan cut in half: the failure mode of an aborted download, and the one that
    // would reach a React render path as an exception if the decode were not guarded.
    expect(decodePoster(full.slice(0, Math.floor(full.length / 2)), 24, 18)).toBeNull();
  });

  it("returns null when there is no room to draw", () => {
    expect(decodePoster(bytes(BASELINE_JPEG), 0, 18)).toBeNull();
    expect(decodePoster(bytes(BASELINE_JPEG), 24, 0)).toBeNull();
  });
});
