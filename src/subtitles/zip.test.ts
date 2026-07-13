import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { extractSrtFromZip } from "./zip";

interface Entry {
  name: string;
  data: Buffer;
  store?: boolean;
}

// Hand-rolled zip: only the fields the extractor reads are filled (crc stays 0).
function makeZip(entries: Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.store ? 0 : 8;
    const comp = e.store ? e.data : deflateRawSync(e.data);
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(e.data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const SRT = "1\n00:00:01,000 --> 00:00:02,000\nhello\n";
const MAX = 2 * 1024 * 1024;

describe("extractSrtFromZip", () => {
  it("extracts a deflated .srt entry", () => {
    const zip = makeZip([{ name: "movie.srt", data: Buffer.from(SRT) }]);
    expect(extractSrtFromZip(zip, MAX)).toBe(SRT);
  });

  it("picks the .srt entry among others and strips a BOM", () => {
    const zip = makeZip([
      { name: "readme.txt", data: Buffer.from("not subs") },
      { name: "Movie.SRT", data: Buffer.from("\uFEFF" + SRT) },
      { name: "other.srt", data: Buffer.from("second") },
    ]);
    expect(extractSrtFromZip(zip, MAX)).toBe(SRT);
  });

  it("handles method 0 (store)", () => {
    const zip = makeZip([{ name: "movie.srt", data: Buffer.from(SRT), store: true }]);
    expect(extractSrtFromZip(zip, MAX)).toBe(SRT);
  });

  it("returns null when there is no .srt entry", () => {
    const zip = makeZip([{ name: "readme.txt", data: Buffer.from("hi") }]);
    expect(extractSrtFromZip(zip, MAX)).toBeNull();
  });

  it("returns null for malformed buffers instead of throwing", () => {
    expect(extractSrtFromZip(Buffer.alloc(0), MAX)).toBeNull();
    expect(extractSrtFromZip(Buffer.from("PK\x03\x04garbage"), MAX)).toBeNull();
    const truncated = makeZip([{ name: "movie.srt", data: Buffer.from(SRT) }]).subarray(0, 40);
    expect(extractSrtFromZip(Buffer.from(truncated), MAX)).toBeNull();
  });

  it("returns null when inflated output would exceed maxBytes (zip bomb)", () => {
    const zip = makeZip([{ name: "bomb.srt", data: Buffer.alloc(1024 * 1024) }]);
    expect(extractSrtFromZip(zip, 1024)).toBeNull();
  });
});
