import { describe, it, expect } from "vitest";
import { mapBittorrentedResults, bittorrented } from "./bittorrented";

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
      "bittorrented",
    );
    expect(r).toMatchObject({
      infoHash: "4e60be2d0b87c93ea6fc20d123d74bf9e9379999",
      name: "Old School (2003)",
      sizeBytes: 733698385,
      seeders: 41,
      leechers: 5,
      numFiles: 6,
      source: "bittorrented",
    });
    expect(r!.magnet).toContain("xt=urn:btih:4e60be2d0b87c93ea6fc20d123d74bf9e9379999");
    expect(r!.added).toBe(Math.floor(Date.parse("2026-01-23T22:28:03.159398+00:00") / 1000));
  });

  it("defaults missing seeders/size to 0", () => {
    const [r] = mapBittorrentedResults(
      [{ torrent_infohash: "a".repeat(40), torrent_name: "x", torrent_seeders: null }],
      "bittorrented",
    );
    expect(r).toMatchObject({ seeders: 0, leechers: 0, sizeBytes: 0 });
  });

  it("drops rows without a valid 40-char info hash", () => {
    expect(
      mapBittorrentedResults(
        [{ torrent_name: "no hash" }, { torrent_infohash: "tooshort", torrent_name: "bad" }],
        "bittorrented",
      ),
    ).toEqual([]);
  });

  it("falls back to the info hash when the name is missing", () => {
    const [r] = mapBittorrentedResults([{ torrent_infohash: "b".repeat(40) }], "bittorrented");
    expect(r!.name).toBe("b".repeat(40));
  });
});

describe("bittorrented", () => {
  it("feeds Movies and TV only, never Games or Anime", () => {
    expect(bittorrented.id).toBe("bittorrented");
    expect(bittorrented.groups).toEqual(["Movies", "TV"]);
    expect(bittorrented.groups).not.toContain("Games");
    expect(bittorrented.groups).not.toContain("Anime");
    expect(bittorrented.reportsHealth).toBe(true);
  });
});
