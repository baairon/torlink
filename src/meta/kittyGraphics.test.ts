import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  MAX_PLACEHOLDER_CELLS,
  PLACEHOLDER,
  decodeGraphicsPoster,
  deleteIssued,
  diacritic,
  idColor,
  nextImageId,
  placeholderLines,
  transmitChunks,
  writeChunks,
} from "./kittyGraphics";

// A real 2x2 baseline JPEG, the same fixture image.test.ts inlines and for the same reason: the
// repo carries no binary files. Duplicated rather than exported across test files — a shared
// fixture module for one constant would be a module that exists only to be imported twice.
const BASELINE_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgs" +
  "LEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB" +
  "QUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQA" +
  "QAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEA" +
  "AhEDEQA/ADoDFU3/2Q==";

// A real 2x3 baseline JPEG: three pixels tall to two wide, which is the aspect both metadata hosts
// serve posters at. Inline for the same reason as the fixture above, and separate from it because
// the square one cannot reach a full-height pane's cell box at all — fitCells gives a square source
// half as many rows as columns, so no budget makes it the 68x51 the tests below are about.
const POSTER_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19i" +
  "Z2hnPk1xeXBkeFxlZ2MBERISGBUYLxoaL2NCOEJjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2Nj" +
  "Y2NjY//AABEIAAMAAgMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQEC" +
  "AwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVm" +
  "Z2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq" +
  "8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIy" +
  "gQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SF" +
  "hoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEA" +
  "AhEDEQA/AJJNMtHkZjGwLEk4kYD8geK6aTagkm9u7OuFGE4qUlds/wD/2Q==";

const bytes = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, "base64"));

const segmenter = new Intl.Segmenter();
const graphemes = (s: string): string[] => [...segmenter.segment(s)].map((g) => g.segment);

describe("the row/column diacritics", () => {
  it("is strictly increasing", () => {
    // Ordering *is* the encoding: index i means "the i-th of these", so a pair swapped in
    // transcription silently addresses two wrong rows rather than failing.
    for (let i = 1; i < MAX_PLACEHOLDER_CELLS; i++) {
      const prev = diacritic(i - 1) ?? "";
      const cur = diacritic(i) ?? "";
      expect((cur.codePointAt(0) ?? 0) > (prev.codePointAt(0) ?? 0)).toBe(true);
    }
  });

  it("joins every entry to the placeholder as a single grapheme", () => {
    // The property the whole scheme rests on: Ink measures graphemes, so a mark that started a new
    // cluster would make one cell of art two cells wide and shear the picture.
    for (let i = 0; i < MAX_PLACEHOLDER_CELLS; i++) {
      expect(graphemes(PLACEHOLDER + (diacritic(i) ?? ""))).toHaveLength(1);
    }
  });

  it("is exactly the marks kitty derives, re-derived from ICU", () => {
    // kitty's list is every combining mark of canonical class 230 that takes no part in canonical
    // composition. Neither property has a JavaScript API, but both are observable through
    // normalization: canonical ordering only ever swaps an adjacent pair whose classes differ and
    // are both non-zero, and a mark that composes appears inside some character's decomposition.
    // Deriving it here rather than eyeballing the table is what makes a transcription slip a
    // failing test.
    const BASE = "一"; // composes with nothing, so only reordering can change these strings
    const REF230 = "̅";
    const REF220 = "̖";
    const stays = (s: string): boolean => s.normalize("NFD") === s;

    const composing = new Set<number>();
    for (let cp = 0; cp < 0x1d250; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      const decomposed = ch.normalize("NFD");
      if (decomposed === ch) continue;
      for (const part of decomposed) {
        if (part !== ch) composing.add(part.codePointAt(0) ?? 0);
      }
    }

    const derived: number[] = [];
    const last = diacritic(MAX_PLACEHOLDER_CELLS - 1)?.codePointAt(0) ?? 0;
    for (let cp = 0x300; cp <= last; cp++) {
      const ch = String.fromCodePoint(cp);
      if (!/\p{M}/u.test(ch)) continue;
      if (composing.has(cp)) continue;
      // Neither order reorders: equal class, or class zero — which the third probe rules out,
      // since a class-zero mark never reorders with anything.
      if (!stays(BASE + REF230 + ch) || !stays(BASE + ch + REF230)) continue;
      if (stays(BASE + ch + REF220)) continue;
      derived.push(cp);
    }

    const table = Array.from({ length: MAX_PLACEHOLDER_CELLS }, (_, i) =>
      diacritic(i)?.codePointAt(0),
    );
    expect(table).toEqual(derived);
  });

  it("starts and ends where kitty's table does", () => {
    // Spot values, independent of the derivation above: if ICU and the rule ever agreed on the
    // wrong list, these would still catch it.
    expect(diacritic(0)).toBe("̅");
    expect(diacritic(1)).toBe("̍");
    expect(diacritic(2)).toBe("̎");
    expect(diacritic(3)).toBe("̐");
    expect(diacritic(MAX_PLACEHOLDER_CELLS - 1)).toBe("࠭");
    expect(MAX_PLACEHOLDER_CELLS).toBe(129);
    expect(diacritic(MAX_PLACEHOLDER_CELLS)).toBeNull();
    expect(diacritic(-1)).toBeNull();
  });
});

describe("placeholderLines", () => {
  it("names the row and the column of every single cell", () => {
    const lines = placeholderLines(0x010203, 3, 2) ?? [];
    expect(lines).toHaveLength(2);
    for (const [row, line] of lines.entries()) {
      const cells = graphemes(line);
      // One grapheme per cell is the width guarantee: three cells of art occupy three columns.
      expect(cells).toHaveLength(3);
      for (const [col, cell] of cells.entries()) {
        expect(cell).toBe(PLACEHOLDER + diacritic(row) + diacritic(col));
      }
    }
  });

  it("refuses a picture with no cells or more cells than the table can address", () => {
    expect(placeholderLines(1, 0, 4)).toBeNull();
    expect(placeholderLines(1, 4, 0)).toBeNull();
    expect(placeholderLines(1, MAX_PLACEHOLDER_CELLS + 1, 4)).toBeNull();
    expect(placeholderLines(1, 4, MAX_PLACEHOLDER_CELLS + 1)).toBeNull();
    expect(placeholderLines(1, MAX_PLACEHOLDER_CELLS, MAX_PLACEHOLDER_CELLS)).not.toBeNull();
  });
});

describe("image ids", () => {
  it("keeps all three colour bytes non-zero", () => {
    // A zero byte is the one an SGR round trip or a "default foreground" reading can eat, and an
    // id short one byte is a different id.
    for (let i = 0; i < 600; i++) {
      const id = nextImageId();
      expect(id & 0xff).not.toBe(0);
      expect((id >> 8) & 0xff).not.toBe(0);
      expect((id >> 16) & 0xff).not.toBe(0);
    }
  });

  it("hands out a different id each time", () => {
    const ids = Array.from({ length: 300 }, () => nextImageId());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("round-trips an id through the colour that carries it", () => {
    const id = nextImageId();
    expect(idColor(id)).toMatch(/^#[0-9a-f]{6}$/);
    expect(Number.parseInt(idColor(id).slice(1), 16)).toBe(id);
    expect(idColor(0x0a0b0c)).toBe("#0a0b0c");
  });
});

describe("decodeGraphicsPoster", () => {
  it("sizes the pixels off the cells and fills the budget", () => {
    const poster = decodeGraphicsPoster(bytes(BASELINE_JPEG), 12, 18);
    expect(poster?.cols).toBe(12);
    expect(poster?.rows).toBe(6); // square source: half as many rows as columns
    expect(poster?.pxW).toBe(12 * 8);
    expect(poster?.pxH).toBe(6 * 16);
    // Exactly kitty's f=24 payload: three bytes a pixel, row-major, nothing around them.
    expect(poster?.rgb.length).toBe(12 * 8 * 6 * 16 * 3);
  });

  it("returns null rather than throwing for bytes that are not a JPEG", () => {
    expect(decodeGraphicsPoster(new Uint8Array([1, 2, 3]), 12, 18)).toBeNull();
    expect(decodeGraphicsPoster(new Uint8Array(0), 12, 18)).toBeNull();
  });

  it("returns null when there is no room to draw", () => {
    expect(decodeGraphicsPoster(bytes(BASELINE_JPEG), 0, 18)).toBeNull();
    expect(decodeGraphicsPoster(bytes(BASELINE_JPEG), 12, 0)).toBeNull();
  });

  it("refuses more picture than the diacritic table can address", () => {
    // The one ceiling that still answers with null: past 129 cells on an axis a placeholder cannot
    // name its own row or column, so the half-block tier draws the poster instead.
    expect(decodeGraphicsPoster(bytes(BASELINE_JPEG), MAX_PLACEHOLDER_CELLS + 1, 200)).toBeNull();
    // The largest picture the table *can* address is not refused, it is clamped — see below.
    const biggest = decodeGraphicsPoster(
      bytes(POSTER_JPEG),
      MAX_PLACEHOLDER_CELLS,
      MAX_PLACEHOLDER_CELLS,
    );
    expect(biggest?.cols).toBe(MAX_PLACEHOLDER_CELLS);
    expect(biggest?.rgb.length ?? 0).toBeLessThanOrEqual(1_200_000);
  });

  it("clamps the pixel scale rather than refusing a pane the wire budget cannot afford", () => {
    // The focused info pane on a 220x64 terminal. At the full 8x16 pixels a cell this is 544x816,
    // which is 1332 KB of raw RGB — over the 1.2 MB ceiling, and so no picture at all until now.
    const poster = decodeGraphicsPoster(bytes(POSTER_JPEG), 68, 51);
    expect(poster?.cols).toBe(68);
    expect(poster?.rows).toBe(51);
    expect(poster?.pxW).toBe(516);
    expect(poster?.pxH).toBe(774);
    // The declared source size and the transmitted byte count have to agree exactly, or the
    // terminal reads the payload as a differently shaped image and draws noise.
    expect(poster?.rgb.length).toBe(516 * 774 * 3);
    expect(poster?.rgb.length).toBe(1_198_152);
    expect(poster?.rgb.length ?? 0).toBeLessThanOrEqual(1_200_000);
    // One factor on both axes, so the picture comes back softer and not stretched: the sampled
    // pixels are still square in a cell twice as tall as it is wide.
    expect((poster?.pxW ?? 0) / 68).toBeCloseTo((poster?.pxH ?? 0) / 51 / 2, 2);
  });

  it("never gives a bigger pane less picture than a smaller one", () => {
    // The inversion the flat cap caused: at 220x64 the unfocused pane got a native image and the
    // focused pane, being bigger, tripped the cap and dropped to half-blocks — so focusing a row
    // downgraded its poster. Growing the pane must never cost the user picture.
    const unfocused = decodeGraphicsPoster(bytes(POSTER_JPEG), 30, 23);
    const focused = decodeGraphicsPoster(bytes(POSTER_JPEG), 68, 51);
    // The smaller pane is under the budget at full scale and is left there: 240x368, 265 KB.
    expect(unfocused?.rgb.length).toBe(30 * 8 * 23 * 16 * 3);
    expect(focused).not.toBeNull();
    expect(focused?.cols ?? 0).toBeGreaterThan(unfocused?.cols ?? 0);
    expect(focused?.rgb.length ?? 0).toBeGreaterThan(unfocused?.rgb.length ?? 0);
  });

  it("leaves a pane inside the budget at the full 8x16 pixels a cell", () => {
    const poster = decodeGraphicsPoster(bytes(BASELINE_JPEG), 60, 30);
    expect(poster?.pxW).toBe(60 * 8);
    expect(poster?.pxH).toBe(30 * 16);
  });
});

describe("transmitChunks", () => {
  const poster = decodeGraphicsPoster(bytes(BASELINE_JPEG), 12, 18);
  const chunks = transmitChunks(0x010203, poster ?? { cols: 0, rows: 0, pxW: 0, pxH: 0, rgb: new Uint8Array() });
  const payload = (chunk: string): string => chunk.slice(chunk.indexOf(";") + 1, -2);

  it("carries the pixels byte for byte", () => {
    const b64 = chunks.map(payload).join("");
    const raw = new Uint8Array(inflateSync(Buffer.from(b64, "base64")));
    expect(Buffer.from(raw).equals(Buffer.from(poster?.rgb ?? new Uint8Array()))).toBe(true);
  });

  it("declares the placement on the first chunk and closes on the last", () => {
    const first = chunks[0] ?? "";
    expect(first.startsWith("\u001b_G")).toBe(true);
    // U=1 is what makes the placement virtual, which is what the placeholders below need; q=2
    // suppresses the acknowledgement that would otherwise land in Ink's stdin as keystrokes.
    expect(first).toContain("a=T,U=1,q=2,i=66051,");
    expect(first).toContain("f=24,o=z,");
    expect(first).toContain(`s=${poster?.pxW},v=${poster?.pxH},c=${poster?.cols},r=${poster?.rows}`);
    expect(chunks.at(-1)).toContain("m=0;");
    for (const chunk of chunks.slice(0, -1)) expect(chunk).toContain("m=1;");
    // Continuation chunks carry the flag and nothing else.
    for (const chunk of chunks.slice(1)) expect(chunk.startsWith("\u001b_Gm=")).toBe(true);
  });

  it("keeps every chunk inside the protocol's payload limit", () => {
    // Noise, not the solid-red fixture: a flat picture deflates to a few hundred bytes and never
    // has to be split at all. A linear congruential fill is incompressible enough to reach several
    // chunks and deterministic enough to assert on.
    let seed = 1;
    const rgb = new Uint8Array(40 * 80 * 3);
    for (let i = 0; i < rgb.length; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      // High bits: the low bits of a linear congruential generator are short-period and deflate
      // eats them, which would leave this testing one chunk again.
      rgb[i] = (seed >>> 16) & 0xff;
    }
    const noisy = transmitChunks(7, { cols: 5, rows: 5, pxW: 40, pxH: 80, rgb });
    expect(noisy.length).toBeGreaterThan(1);
    expect(noisy.at(-1)).toContain("m=0;");
    // Split and rejoined is still the same picture, which is the only thing chunking may change.
    const raw = new Uint8Array(inflateSync(Buffer.from(noisy.map(payload).join(""), "base64")));
    expect(Buffer.from(raw).equals(Buffer.from(rgb))).toBe(true);
    for (const chunk of noisy) {
      expect(payload(chunk).length).toBeLessThanOrEqual(4096);
      expect(chunk.endsWith("\u001b\\")).toBe(true);
    }
  });

  it("has nothing to send for a picture with no pixels", () => {
    expect(transmitChunks(1, { cols: 0, rows: 0, pxW: 0, pxH: 0, rgb: new Uint8Array() })).toEqual([]);
  });
});

describe("writeChunks", () => {
  it("writes the whole transmission as one write", () => {
    // One write, so no repaint can land inside an image. Ink writes whole frames the same way.
    const writes: string[] = [];
    const out = { write: (s: string): boolean => (writes.push(s), true) } as NodeJS.WriteStream;
    writeChunks(out, ["a", "b", "c"]);
    expect(writes).toEqual(["abc"]);
  });

  it("writes nothing for nothing, and swallows a broken stream", () => {
    const writes: string[] = [];
    const out = { write: (s: string): boolean => (writes.push(s), true) } as NodeJS.WriteStream;
    writeChunks(out, []);
    expect(writes).toEqual([]);
    const broken = {
      write: (): boolean => {
        throw new Error("EPIPE");
      },
    } as unknown as NodeJS.WriteStream;
    expect(() => writeChunks(broken, ["x"])).not.toThrow();
  });
});

describe("deleteIssued", () => {
  it("names the ids this module handed out, one escape each", () => {
    const mine = [nextImageId(), nextImageId(), nextImageId()];
    const escapes = deleteIssued();
    // d=I frees the image data as well as its placements; d=i would leave the pixels in the store.
    for (const id of mine) expect(escapes).toContain(`\u001b_Ga=d,d=I,i=${id},q=2\u001b\\`);
    // One escape per id: at least one ESC-terminated chunk for each of ours, tolerant of the ids
    // other tests in this file have already added to the same module-level set.
    expect(escapes.split("\u001b\\").length - 1).toBeGreaterThanOrEqual(mine.length);
  });

  it("never frees an image it did not put there", () => {
    const mine = nextImageId();
    const escapes = deleteIssued();
    // d=A frees every image in the terminal *window*, including whatever the user drew before
    // launching torlink. Ours are named one by one because nothing else distinguishes them.
    expect(escapes).not.toContain("d=A");
    expect(escapes).not.toContain("d=a");
    // An id with a zero colour byte is a shape nextImageId cannot produce, so it could only be
    // someone else's image — 0x000102 stands for all of them.
    expect(escapes).not.toContain("i=258,");
    // Every id named is one this module could have handed out: inside 24 bits, no zero byte.
    const named = [...escapes.matchAll(/i=(\d+),/g)].map((m) => Number(m[1]));
    expect(named).toContain(mine);
    for (const id of named) {
      expect(id).toBeLessThanOrEqual(0xffffff);
      expect(id & 0xff).not.toBe(0);
      expect((id >> 8) & 0xff).not.toBe(0);
      expect((id >> 16) & 0xff).not.toBe(0);
    }
  });

  it("suppresses the acknowledgement on every escape", () => {
    // Same reason as transmitChunks: the reply arrives on stdin, where Ink's parse-keypress reads
    // it as keystrokes — and this one is sent while the app is tearing down and least able to cope.
    nextImageId(); // one image to name, whatever else this file has already minted
    const escapes = deleteIssued().split("\u001b\\").slice(0, -1);
    expect(escapes.length).toBeGreaterThan(0);
    for (const escape of escapes) {
      expect(escape.startsWith("\u001b_G")).toBe(true);
      expect(escape).toContain("q=2");
    }
  });
});
