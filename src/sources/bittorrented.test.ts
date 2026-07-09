import { describe, it, expect } from "vitest";
import { mapBittorrentedResults, bittorrentedSources } from "./bittorrented";

describe("mapBittorrentedResults", () => {
  it("maps an API row to a torrent result with a built magnet, tagged by source id", () => {
    const [r] = mapBittorrentedResults(
      [
        {
          torrent_infohash: "4E60BE2D0B87C93EA6FC20D123D74BF9E9379999",
          torrent_name: "Old School (2003)",
          torrent_total_size: 733698385,
          torrent_seeders: 41,
          torrent_leechers: 5,
          torrent_file_count: 6,
          torrent_created_at: "2026-01-23T22:28:03.159398+00:00",
        },
      ],
      "bt-video",
    );
    expect(r).toMatchObject({
      infoHash: "4e60be2d0b87c93ea6fc20d123d74bf9e9379999",
      name: "Old School (2003)",
      sizeBytes: 733698385,
      seeders: 41,
      leechers: 5,
      numFiles: 6,
      source: "bt-video",
    });
    expect(r!.magnet).toContain("xt=urn:btih:4e60be2d0b87c93ea6fc20d123d74bf9e9379999");
    expect(r!.added).toBe(Math.floor(Date.parse("2026-01-23T22:28:03.159398+00:00") / 1000));
  });

  it("defaults missing seeders/size to 0", () => {
    const [r] = mapBittorrentedResults(
      [{ torrent_infohash: "a".repeat(40), torrent_name: "x", torrent_seeders: null }],
      "bt-audio",
    );
    expect(r).toMatchObject({ seeders: 0, leechers: 0, sizeBytes: 0 });
  });

  it("drops rows without a valid 40-char info hash", () => {
    expect(
      mapBittorrentedResults(
        [{ torrent_name: "no hash" }, { torrent_infohash: "tooshort", torrent_name: "bad" }],
        "bt-video",
      ),
    ).toEqual([]);
  });

  it("falls back to the info hash when the name is missing", () => {
    const [r] = mapBittorrentedResults([{ torrent_infohash: "b".repeat(40) }], "bt-ebook");
    expect(r!.name).toBe("b".repeat(40));
  });
});

describe("bittorrentedSources", () => {
  it("registers one source per media-type tab", () => {
    expect(bittorrentedSources.map((s) => s.id)).toEqual([
      "bt-video",
      "bt-audio",
      "bt-ebook",
      "bt-xxx",
      "bt-other",
    ]);
    expect(bittorrentedSources.map((s) => s.group)).toEqual([
      "Video",
      "Music",
      "Books",
      "XXX",
      "Other",
    ]);
  });
});
