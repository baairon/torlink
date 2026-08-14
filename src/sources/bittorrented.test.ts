import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapBittorrentedResults, bittorrented, bittorrentedMusic } from "./bittorrented";
import { fetchResilient } from "../util/net";

vi.mock("../util/net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../util/net")>();
  return { ...actual, fetchResilient: vi.fn() };
});

const mockFetch = vi.mocked(fetchResilient);

const apiPage = (results: unknown[]): Response =>
  ({ ok: true, status: 200, json: async () => ({ results }) }) as unknown as Response;

const row = (hash: string, name: string): unknown => ({
  torrent_infohash: hash,
  torrent_name: name,
});

const askedFor = (call: number): URLSearchParams =>
  new URL(String(mockFetch.mock.calls[call]![0])).searchParams;

beforeEach(() => {
  mockFetch.mockReset();
});

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

// The two sources are one search() apart: they differ only in the media type
// they ask the API for and the id they stamp on the rows that come back. Swap
// either half and the tabs still fill, just with the wrong media — so both
// halves are asserted together, per source.
describe("bittorrented", () => {
  it("feeds Movies and TV only, never Games, Anime or Music", () => {
    expect(bittorrented.id).toBe("bittorrented");
    expect(bittorrented.groups).toEqual(["Movies", "TV"]);
    expect(bittorrented.groups).not.toContain("Games");
    expect(bittorrented.groups).not.toContain("Anime");
    expect(bittorrented.groups).not.toContain("Music");
    expect(bittorrented.reportsHealth).toBe(true);
  });

  it("asks the API for video and tags the rows bittorrented", async () => {
    mockFetch.mockResolvedValueOnce(apiPage([row("b".repeat(40), "Old School (2003)")]));
    const results = await bittorrented.search("old school");
    expect(askedFor(0).get("type")).toBe("video");
    expect(askedFor(0).get("q")).toBe("old school");
    expect(results.map((r) => r.source)).toEqual(["bittorrented"]);
  });
});

describe("bittorrentedMusic", () => {
  it("feeds Music only, never the video categories", () => {
    expect(bittorrentedMusic.id).toBe("bittorrented-music");
    expect(bittorrentedMusic.groups).toEqual(["Music"]);
    expect(bittorrentedMusic.groups).not.toContain("Movies");
    expect(bittorrentedMusic.groups).not.toContain("TV");
    expect(bittorrentedMusic.reportsHealth).toBe(true);
  });

  it("asks the API for audio and tags the rows bittorrented-music", async () => {
    mockFetch.mockResolvedValueOnce(
      apiPage([row("a".repeat(40), "Daft Punk - Discovery (2001) [FLAC]")]),
    );
    const results = await bittorrentedMusic.search("daft punk");
    expect(askedFor(0).get("type")).toBe("audio");
    expect(askedFor(0).get("q")).toBe("daft punk");
    expect(results.map((r) => r.source)).toEqual(["bittorrented-music"]);
  });

  // "audio" is the API's own vocabulary and a 400 otherwise: it rejects the
  // obvious "music" outright, so the value is pinned rather than inferred.
  it("never sends the category name as the media type", async () => {
    mockFetch.mockResolvedValueOnce(apiPage([]));
    await bittorrentedMusic.search("daft punk");
    expect(askedFor(0).get("type")).not.toBe("music");
  });

  it("skips the request entirely for queries the API would reject", async () => {
    expect(await bittorrentedMusic.search("ab")).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
