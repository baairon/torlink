import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

// Minimal zip reader: enough to pull the first .srt out of a subtitle archive.
// Entry names are only ever matched, never used as a filesystem path. Any
// malformed input (bad signatures, truncated buffers, oversized output) lands
// in the catch and returns null.
export function extractSrtFromZip(buf: Buffer, maxBytes: number): string | null {
  try {
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return null;

    const count = buf.readUInt16LE(eocd + 10);
    let off = buf.readUInt32LE(eocd + 16);
    for (let i = 0; i < count; i++) {
      if (buf.readUInt32LE(off) !== CENTRAL_SIG) return null;
      const method = buf.readUInt16LE(off + 10);
      const compSize = buf.readUInt32LE(off + 20);
      const nameLen = buf.readUInt16LE(off + 28);
      const extraLen = buf.readUInt16LE(off + 30);
      const commentLen = buf.readUInt16LE(off + 32);
      const localOff = buf.readUInt32LE(off + 42);
      const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
      off += 46 + nameLen + extraLen + commentLen;

      if (!name.toLowerCase().endsWith(".srt")) continue;
      if (buf.readUInt32LE(localOff) !== LOCAL_SIG) return null;
      // The local header's own name/extra lengths can differ from the central
      // directory's, so the data offset comes from here.
      const dataStart =
        localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
      if (dataStart + compSize > buf.length) return null;
      const data = buf.subarray(dataStart, dataStart + compSize);

      let out: Buffer;
      if (method === 8) {
        out = inflateRawSync(data, { maxOutputLength: maxBytes });
      } else if (method === 0) {
        if (compSize > maxBytes) return null;
        out = data;
      } else {
        return null;
      }
      return out.toString("utf8").replace(/^\uFEFF/, "");
    }
    return null;
  } catch {
    return null;
  }
}
