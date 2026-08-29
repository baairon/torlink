import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createTorrentFor, torrentOptions, torrentPathFor } from "./create";
import { magnetFromTorrentBytes } from "../sources/torrentFile";

async function fixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-create-"));
  const content = path.join(dir, "album");
  await fs.mkdir(content);
  await fs.writeFile(path.join(content, "one.txt"), "first\n");
  await fs.writeFile(path.join(content, "two.txt"), "second\n");
  return content;
}

describe("torrentOptions", () => {
  // create-torrent supplies its own announce list when given none, so passing
  // an empty array would replace a working default with nothing.
  it("omits announce entirely rather than passing an empty list", () => {
    expect(torrentOptions([])).toEqual({});
    expect(torrentOptions(["udp://t.test:1337"])).toEqual({ announce: ["udp://t.test:1337"] });
  });
});

describe("torrentPathFor", () => {
  // Beside the data, not in a config dir: moving the files and leaving the
  // torrent behind is how you end up with a magnet nobody can serve.
  it("names the torrent after the content and puts it alongside", () => {
    expect(torrentPathFor("/srv/media/album")).toBe("/srv/media/album.torrent");
    expect(torrentPathFor("/srv/media/film.mkv")).toBe("/srv/media/film.mkv.torrent");
  });
});

describe("createTorrentFor", () => {
  it("writes a .torrent that parses back to the magnet it returns", async () => {
    const content = await fixture();
    const created = await createTorrentFor(content, ["udp://tracker.test:1337/announce"]);

    expect(created.infoHash).toMatch(/^[0-9a-f]{40}$/);
    expect(created.name).toBe("album");
    expect(created.magnet).toContain(created.infoHash);

    // The file on disk has to be the same torrent as the magnet describes.
    const onDisk = await fs.readFile(created.torrentPath);
    const reparsed = await magnetFromTorrentBytes(new Uint8Array(onDisk));
    expect(reparsed?.infoHash).toBe(created.infoHash);
  });

  /*
   * The field that makes seeding existing data work at all.
   *
   * A torrent names its own top-level entry, so a client seeding
   * /srv/media/album must be pointed at /srv/media. Point it at the album and
   * it looks for album/album, finds nothing, and downloads a second copy
   * beside the one already there.
   */
  it("reports the content's parent as the directory to seed from", async () => {
    const content = await fixture();
    const created = await createTorrentFor(content);
    expect(created.contentDir).toBe(path.dirname(content));
    expect(created.contentDir).not.toBe(content);
  });

  // The announce list is the difference between a torrent anyone can find and
  // a DHT-only one, so it has to survive into the magnet.
  it("carries the trackers it was given into the magnet", async () => {
    const content = await fixture();
    const created = await createTorrentFor(content, ["udp://tracker.test:1337/announce"]);
    expect(decodeURIComponent(created.magnet)).toContain("udp://tracker.test:1337/announce");
  });

  // A direct instruction from an operator, unlike a file appearing in a watch
  // folder: failing quietly would leave them with no torrent and no reason.
  it("throws on a path that is not there", async () => {
    await expect(createTorrentFor("/nope/not/here")).rejects.toThrow();
  });
});
