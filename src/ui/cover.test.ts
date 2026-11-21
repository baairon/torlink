import { afterEach, describe, expect, it, vi } from "vitest";
import { encode } from "jpeg-js";
import { clearCoverCache, decodeCover, fitCells, loadPixels, toHalfBlocks, type Pixels } from "./cover";
import { fetchResilient } from "../util/net";

vi.mock("../util/net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../util/net")>();
  return { ...actual, fetchResilient: vi.fn() };
});

const mockFetch = vi.mocked(fetchResilient);

const solid = (width: number, height: number, rgb: (x: number, y: number) => number[]): Pixels => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgb(x, y);
      data.set([r!, g!, b!, 255], (y * width + x) * 4);
    }
  return { width, height, data };
};

const ok = (bytes: Uint8Array): Response =>
  ({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => bytes.buffer }) as unknown as Response;

afterEach(() => {
  mockFetch.mockReset();
  clearCoverCache();
});

describe("fitCells", () => {
  it("keeps a portrait cover's aspect inside the width", () => {
    // 150x200 at 24 cols -> 32 px tall -> 16 rows
    expect(fitCells(150, 200, 24, 40)).toEqual({ cols: 24, rows: 16 });
  });

  it("shrinks the width when the height is the limit", () => {
    expect(fitCells(150, 200, 24, 8)).toEqual({ cols: 12, rows: 8 });
  });
});

describe("toHalfBlocks", () => {
  it("paints the upper pixel as foreground and the lower as background", () => {
    const img = solid(1, 2, (_x, y) => (y === 0 ? [255, 0, 0] : [0, 0, 255]));
    const [line] = toHalfBlocks(img, 1, 1);
    expect(line).toBe("\x1b[38;2;255;0;0m\x1b[48;2;0;0;255m▀\x1b[0m");
  });

  it("averages the source pixels under each cell", () => {
    const img = solid(2, 4, (x) => (x === 0 ? [0, 0, 0] : [200, 100, 50]));
    const [line] = toHalfBlocks(img, 1, 1);
    expect(line).toContain("38;2;100;50;25m");
  });

  it("emits one string per row", () => {
    expect(toHalfBlocks(solid(10, 20, () => [1, 2, 3]), 5, 4)).toHaveLength(4);
  });
});

describe("loadPixels", () => {
  const encoded = encode(solid(30, 40, () => [120, 60, 30]), 90).data;

  it("decodes a JPEG", async () => {
    mockFetch.mockResolvedValueOnce(ok(new Uint8Array(encoded)));
    const img = await loadPixels("https://img.test/a.jpg", new AbortController().signal);
    expect([img?.width, img?.height]).toEqual([30, 40]);
  });

  it("returns null for bytes it can't decode, and doesn't refetch them", async () => {
    mockFetch.mockResolvedValue(ok(new TextEncoder().encode("<html>not an image</html>")));
    const signal = new AbortController().signal;
    expect(await loadPixels("https://img.test/b.png", signal)).toBeNull();
    expect(await loadPixels("https://img.test/b.png", signal)).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when the host errors", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers() } as unknown as Response);
    expect(await loadPixels("https://img.test/c.jpg", new AbortController().signal)).toBeNull();
  });

  it("decodeCover reads dimensions", () => {
    const img = decodeCover(new Uint8Array(encoded));
    expect([img.width, img.height]).toEqual([30, 40]);
  });
});
