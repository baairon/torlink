import { describe, it, expect, vi, beforeEach } from "vitest";
import { deflateRawSync } from "node:zlib";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadSubtitle } from "./fetchSubtitle";
import type { SubtitleCandidate } from "./types";

const SRT = "1\n00:00:01,000 --> 00:00:02,000\nhello\n";

function candidate(downloadUrl = "https://api.gestdown.info/subtitles/download/x"): SubtitleCandidate {
  return { releaseName: "Show.S01E01.720p", lang: "en", downloadUrl };
}

// Single-entry deflate zip with just the fields the extractor reads.
function makeZip(name: string, data: Buffer): Buffer {
  const comp = deflateRawSync(data);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(comp.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(nameBuf.length, 28);
  cen.writeUInt32LE(0, 42);
  const cdOffset = 30 + nameBuf.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + nameBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, comp, cen, nameBuf, eocd]);
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "torlnk-subs-"));
});

describe("downloadSubtitle", () => {
  it("writes plain srt bodies to destPath", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response("\uFEFF" + SRT));
    const dest = join(dir, "a.srt");
    expect(await downloadSubtitle(candidate(), dest, f)).toBe(true);
    expect(await readFile(dest, "utf8")).toBe(SRT);
  });

  it("routes PK-magic bodies through zip extraction", async () => {
    const zip = makeZip("movie.srt", Buffer.from(SRT));
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(zip)));
    const dest = join(dir, "b.srt");
    expect(await downloadSubtitle(candidate(), dest, f)).toBe(true);
    expect(await readFile(dest, "utf8")).toBe(SRT);
  });

  it("sends the yts-subs referer for yifysubtitles.ch downloads", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(SRT));
    const dest = join(dir, "c.srt");
    await downloadSubtitle(candidate("https://yifysubtitles.ch/subtitle/x.zip"), dest, f);
    const headers = (f.mock.calls[0]![1]!.headers ?? {}) as Record<string, string>;
    expect(headers["referer"]).toBe("https://yts-subs.com/");
  });

  it("aborts bodies over 2 MB without buffering them and returns false", async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(256 * 1024));
      },
    });
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream));
    const dest = join(dir, "d.srt");
    expect(await downloadSubtitle(candidate(), dest, f)).toBe(false);
    expect(existsSync(dest)).toBe(false);
    // The reader stops just past the cap instead of draining the stream.
    expect(pulls).toBeLessThan(20);
  });

  it("never overwrites an existing file", async () => {
    const dest = join(dir, "e.srt");
    await writeFile(dest, "original");
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(SRT));
    expect(await downloadSubtitle(candidate(), dest, f)).toBe(false);
    expect(await readFile(dest, "utf8")).toBe("original");
  });

  it("rejects content without a timing arrow", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>blocked</html>"));
    const dest = join(dir, "f.srt");
    expect(await downloadSubtitle(candidate(), dest, f)).toBe(false);
    expect(existsSync(dest)).toBe(false);
  });

  it("returns false on non-OK responses and network errors", async () => {
    const bad = vi.fn<typeof fetch>().mockResolvedValue(new Response("x", { status: 404 }));
    expect(await downloadSubtitle(candidate(), join(dir, "g.srt"), bad)).toBe(false);
    const boom = vi.fn<typeof fetch>().mockRejectedValue(new Error("boom"));
    expect(await downloadSubtitle(candidate(), join(dir, "h.srt"), boom)).toBe(false);
  });
});
