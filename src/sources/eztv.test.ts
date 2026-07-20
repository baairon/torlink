import { describe, it, expect, vi, beforeEach } from "vitest";
import { eztv } from "./eztv";
import { fetchResilient } from "../util/net";

vi.mock("../util/net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../util/net")>();
  return { ...actual, fetchResilient: vi.fn() };
});

const mockFetch = vi.mocked(fetchResilient);

const torrent = (
  hash: string,
  title: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  title,
  filename: `${title.replace(/\s+/g, ".")}.mkv`,
  hash,
  magnet_url: `magnet:?xt=urn:btih:${hash}&dn=x`,
  seeds: 50,
  peers: 5,
  size_bytes: "700000000",
  date_released_unix: 1_700_000_000,
  ...extra,
});

const page = (torrents: Record<string, unknown>[]): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ torrents }),
  }) as unknown as Response;

const H1 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const H2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const H3 = "cccccccccccccccccccccccccccccccccccccccc";

beforeEach(() => {
  mockFetch.mockReset();
});

describe("eztv search", () => {
  it("returns the latest releases unfiltered when browsing (empty query)", async () => {
    mockFetch.mockResolvedValueOnce(page([torrent(H1, "Show One"), torrent(H2, "Show Two")]));
    const results = await eztv.search("");
    expect(results).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("filters client-side when a query is typed instead of returning nothing", async () => {
    mockFetch.mockResolvedValueOnce(
      page([torrent(H1, "Severance S02E01"), torrent(H2, "The Bear S03E04"), torrent(H3, "Severance S02E02")]),
    );
    const results = await eztv.search("severance");
    expect(results.map((r) => r.infoHash)).toEqual([H1, H3]);
  });

  it("requires every query token (AND semantics), case-insensitive", async () => {
    const entries = [torrent(H1, "Severance S02E01 1080p"), torrent(H2, "Severance S02E02 720p")];
    mockFetch.mockResolvedValueOnce(page(entries)).mockResolvedValueOnce(page(entries));
    expect(await eztv.search("SEVERANCE 1080p")).toHaveLength(1);
    expect(await eztv.search("severance 4k")).toHaveLength(0);
  });

  it("matches against the filename too, not just the title", async () => {
    mockFetch.mockResolvedValueOnce(
      page([torrent(H1, "Episode", { filename: "The.Last.of.Us.S02E01.mkv" })]),
    );
    const results = await eztv.search("last of us");
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("Episode");
  });

  it("skips entries with no usable hash or magnet", async () => {
    mockFetch.mockResolvedValueOnce(page([torrent("", "No Hash"), torrent(H1, "Good")]));
    const results = await eztv.search("");
    expect(results).toHaveLength(1);
    expect(results[0]!.infoHash).toBe(H1);
  });
});
