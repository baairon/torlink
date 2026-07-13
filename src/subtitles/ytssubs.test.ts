import { describe, it, expect, vi } from "vitest";
import { searchMovie } from "./ytssubs";

function html(body: string): Response {
  return new Response(body, { status: 200 });
}

// Real pages are one long line; fixtures model the row shapes without newlines.
const SEARCH_HTML =
  `<html><body><ul class="media-list"><li class="media">` +
  `<a href="/movie-imdb/tt1375666"><div class="media-body"><h3 class="media-heading">Inception</h3><small>year 2010</small></div></a></li>` +
  `<li class="media"><a href="/movie-imdb/tt9999999"><div class="media-body"><h3 class="media-heading">Inception Deux</h3><small>year 2024</small></div></a></li>` +
  `</ul></body></html>`;

const MOVIE_HTML =
  `<table class="table"><tbody>` +
  `<tr data-id="90112"><td class="rating-cell">7</td><td class="flag-cell"><span class="sub-lang">English</span></td>` +
  `<td><a href="/subtitles/inception-2010-english-yify-90112"><span class="text-muted">subtitle</span> Inception.2010.1080p.BluRay.x264-REFiNED</a></td></tr>` +
  `<tr data-id="55555"><td class="rating-cell">3</td><td class="flag-cell"><span class="sub-lang">Hebrew</span></td>` +
  `<td><a href="/subtitles/inception-2010-hebrew-yify-55555"><span class="text-muted">subtitle</span> Inception 2010 720p BrRip</a></td></tr>` +
  `</tbody></table>`;

describe("searchMovie", () => {
  it("parses search + movie page into candidates with a yifysubtitles zip url", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(html(SEARCH_HTML))
      .mockResolvedValueOnce(html(MOVIE_HTML));
    const out = await searchMovie("inception", 2010, "en", f);
    expect(out).toEqual([
      {
        releaseName: "Inception.2010.1080p.BluRay.x264-REFiNED",
        lang: "en",
        downloadUrl: "https://yifysubtitles.ch/subtitle/inception-2010-english-yify-90112.zip",
      },
    ]);
    expect(String(f.mock.calls[0]![0])).toContain("https://yts-subs.com/search/");
    expect(String(f.mock.calls[1]![0])).toBe("https://yts-subs.com/movie-imdb/tt1375666");
  });

  it("filters rows to the requested language", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(html(SEARCH_HTML))
      .mockResolvedValueOnce(html(MOVIE_HTML));
    const out = await searchMovie("inception", 2010, "he", f);
    expect(out).toHaveLength(1);
    expect(out[0]!.downloadUrl).toBe(
      "https://yifysubtitles.ch/subtitle/inception-2010-hebrew-yify-55555.zip",
    );
    expect(out[0]!.lang).toBe("he");
  });

  it("returns [] when no search row matches the title, without a movie-page request", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(html(SEARCH_HTML));
    expect(await searchMovie("oldboy", 2003, "en", f)).toEqual([]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("skips rows whose year does not match", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(html(SEARCH_HTML));
    expect(await searchMovie("inception", 1999, "en", f)).toEqual([]);
  });

  it("returns [] on network error instead of throwing", async () => {
    const f = vi.fn<typeof fetch>().mockRejectedValue(new Error("boom"));
    expect(await searchMovie("inception", 2010, "en", f)).toEqual([]);
  });
});
