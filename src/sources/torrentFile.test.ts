import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { magnetFromTorrentFile } from "./torrentFile";

// Hand-rolled bencode, so the fixture is a real .torrent parse-torrent accepts
// rather than a checked-in binary blob.
function bstr(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([Buffer.from(`${b.length}:`), b]);
}

function makeTorrent(announce: string[]): Buffer {
  const info = Buffer.concat([
    Buffer.from("d"),
    bstr("length"),
    Buffer.from("i1024e"),
    bstr("name"),
    bstr("test.bin"),
    bstr("piece length"),
    Buffer.from("i16384e"),
    bstr("pieces"),
    Buffer.from("20:"),
    Buffer.alloc(20, 7),
    Buffer.from("e"),
  ]);
  const head: Buffer[] = [Buffer.from("d")];
  if (announce[0]) head.push(bstr("announce"), bstr(announce[0]));
  if (announce.length) {
    head.push(bstr("announce-list"), Buffer.from("l"));
    for (const url of announce) head.push(Buffer.from("l"), bstr(url), Buffer.from("e"));
    head.push(Buffer.from("e"));
  }
  return Buffer.concat([...head, bstr("info"), info, Buffer.from("e")]);
}

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-torrentfile-"));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(name: string, data: Buffer): Promise<string> {
  const file = path.join(dir, name);
  await fs.writeFile(file, data);
  return file;
}

describe("magnetFromTorrentFile", () => {
  it("reads the info hash and name out of a .torrent", async () => {
    const file = await write("plain.torrent", makeTorrent([]));
    const parsed = await magnetFromTorrentFile(file);
    expect(parsed?.name).toBe("test.bin");
    expect(parsed?.infoHash).toMatch(/^[a-f0-9]{40}$/);
  });

  it("puts the torrent's own trackers in the magnet, ahead of the public ones", async () => {
    const own = "http://private.example.org/announce?pk=xyz";
    const file = await write("private.torrent", makeTorrent([own]));
    const parsed = await magnetFromTorrentFile(file);
    const mine = parsed!.magnet.indexOf(`&tr=${encodeURIComponent(own)}`);
    expect(mine).toBeGreaterThan(-1);
    expect(mine).toBeLessThan(
      parsed!.magnet.indexOf(encodeURIComponent("udp://tracker.opentrackr.org:1337/announce")),
    );
  });

  it("keeps one copy of a tracker the defaults already carry", async () => {
    const dupe = "udp://tracker.opentrackr.org:1337/announce";
    const file = await write("dupe.torrent", makeTorrent([dupe]));
    const parsed = await magnetFromTorrentFile(file);
    const hits = parsed!.magnet.split(`&tr=${encodeURIComponent(dupe)}`).length - 1;
    expect(hits).toBe(1);
  });

  it("returns null for a missing file, a directory, an empty file, and junk", async () => {
    expect(await magnetFromTorrentFile(path.join(dir, "nope.torrent"))).toBe(null);
    expect(await magnetFromTorrentFile(dir)).toBe(null);
    expect(await magnetFromTorrentFile(await write("empty.torrent", Buffer.alloc(0)))).toBe(null);
    expect(
      await magnetFromTorrentFile(await write("junk.torrent", Buffer.from("not a torrent"))),
    ).toBe(null);
  });

  it("refuses a file too large to be metadata rather than reading it in", async () => {
    const big = await write("big.torrent", Buffer.alloc(17 * 1024 * 1024));
    expect(await magnetFromTorrentFile(big)).toBe(null);
  });
});
