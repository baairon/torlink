import { describe, it, expect, vi } from "vitest";
import { searchTv } from "./gestdown";
import { parseRelease } from "./parse";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

const SHOWS = {
  shows: [
    {
      id: "31437de3-1234",
      name: "Severance",
      nbSeasons: 2,
      seasons: [1, 2],
      tvDbId: 371980,
      tmdbId: 95396,
      slug: "severance",
    },
  ],
};

const SUBS = {
  matchingSubtitles: [
    {
      subtitleId: "019474c9-aaaa",
      version: "MiNX",
      completed: true,
      hearingImpaired: false,
      downloadUri: "/subtitles/download/019474c9-aaaa",
      language: "English",
      qualities: ["720p", "1080p"],
      release: null,
    },
    {
      subtitleId: "019474c9-bbbb",
      version: "WIP",
      completed: false,
      hearingImpaired: false,
      downloadUri: "/subtitles/download/019474c9-bbbb",
      language: "English",
      qualities: ["720p"],
      release: null,
    },
  ],
};

describe("searchTv", () => {
  it("maps completed subtitles to candidates with a synthesized release name", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(SHOWS))
      .mockResolvedValueOnce(json(SUBS));
    const out = await searchTv("severance", 1, 2, "en", f);
    expect(out).toEqual([
      {
        releaseName: "Severance.S01E02.720p.1080p-MiNX",
        lang: "en",
        downloadUrl: "https://api.gestdown.info/subtitles/download/019474c9-aaaa",
      },
    ]);
    // The hyphen matters: parseRelease only reads a group off a hyphen tail,
    // and pickBest's top weight rides on .group.
    expect(parseRelease(out[0]!.releaseName)).toMatchObject({
      title: "severance",
      season: 1,
      episode: 2,
      group: "minx",
    });
    expect(f).toHaveBeenCalledTimes(2);
    expect(String(f.mock.calls[1]![0])).toBe(
      "https://api.gestdown.info/subtitles/get/31437de3-1234/1/2/en",
    );
  });

  it("returns [] when no show name matches the title, without a subtitles request", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(json(SHOWS));
    expect(await searchTv("the bear", 1, 1, "en", f)).toEqual([]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("falls back to a show whose name starts with the title", async () => {
    const shows = {
      shows: [
        { id: "aaa", name: "Star Trek: Discovery", slug: "star-trek-discovery" },
        { id: "bbb", name: "Star Trek", slug: "star-trek" },
      ],
    };
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(shows))
      .mockResolvedValueOnce(json({ matchingSubtitles: [] }));
    expect(await searchTv("star trek discovery", 1, 1, "en", f)).toEqual([]);
    expect(String(f.mock.calls[1]![0])).toContain("/subtitles/get/aaa/");
  });

  it("returns [] on a non-OK response", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response("nope", { status: 500 }));
    expect(await searchTv("severance", 1, 2, "en", f)).toEqual([]);
  });

  it("returns [] on network error instead of throwing", async () => {
    const f = vi.fn<typeof fetch>().mockRejectedValue(new Error("boom"));
    expect(await searchTv("severance", 1, 2, "en", f)).toEqual([]);
  });
});
