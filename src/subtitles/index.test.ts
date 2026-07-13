import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { fetchSubtitlesForDownload } from "./index";

const SRT = "1\n00:00:01,000 --> 00:00:02,000\nhello\n";
const MB = 1024 * 1024;

function router(routes: Array<[string, () => Response]>): typeof fetch {
  return vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const hit = routes.find(([frag]) => url.includes(frag));
    if (!hit) throw new Error(`unrouted fetch: ${url}`);
    return hit[1]();
  }) as unknown as typeof fetch;
}

async function makeDir(files: { path: string; length: number }[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-subs-"));
  for (const f of files) {
    await fs.mkdir(path.dirname(path.join(dir, f.path)), { recursive: true });
    await fs.writeFile(path.join(dir, f.path), "x");
  }
  return dir;
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(
    () => true,
    () => false,
  );
}

const MOVIE_NAME = "Inception.2010.1080p.BluRay.x264-REFiNED";

const MOVIE_SEARCH_HTML =
  `<li class="media"><a href="/movie-imdb/tt1375666">` +
  `<h3 class="media-heading">Inception</h3><small>2010</small></a></li>`;

const MOVIE_PAGE_HTML =
  `<table><tbody><tr><td><span class="sub-lang">English</span></td>` +
  `<td><a href="/subtitles/inception-2010-english-yify-90112">` +
  `<span class="text-muted">subtitle</span> ${MOVIE_NAME}</a></td></tr></tbody></table>`;

const TV_NAME = "Severance.S01E01-E02.1080p.WEB.h264";

function tvShows(): Response {
  return new Response(JSON.stringify({ shows: [{ id: "sev-1", name: "Severance" }] }));
}

function tvSubs(uri: string): Response {
  return new Response(
    JSON.stringify({
      matchingSubtitles: [
        { version: "h264", completed: true, downloadUri: uri, qualities: ["1080p", "WEB"] },
      ],
    }),
  );
}

describe("fetchSubtitlesForDownload", () => {
  it("movie: writes <video-basename>.<lang>.srt next to the largest video file", async () => {
    const files = [
      { path: path.join("Inception (2010)", `${MOVIE_NAME}.mkv`), length: 900 * MB },
      { path: path.join("Inception (2010)", "Sample", "sample.mkv"), length: 20 * MB },
      { path: path.join("Inception (2010)", "info.nfo"), length: 900 * MB },
    ];
    const dir = await makeDir(files);
    const fetchImpl = router([
      ["yts-subs.com/search/", () => new Response(MOVIE_SEARCH_HTML)],
      ["yts-subs.com/movie-imdb/tt1375666", () => new Response(MOVIE_PAGE_HTML)],
      ["yifysubtitles.ch/subtitle/", () => new Response(SRT)],
    ]);

    const count = await fetchSubtitlesForDownload({
      name: MOVIE_NAME,
      dir,
      source: "yts",
      files,
      lang: "en",
      fetchImpl,
    });

    expect(count).toBe(1);
    const srt = path.join(dir, "Inception (2010)", `${MOVIE_NAME}.en.srt`);
    await expect(fs.readFile(srt, "utf8")).resolves.toContain("-->");
    expect(await exists(path.join(dir, "Inception (2010)", "Sample", "sample.en.srt"))).toBe(
      false,
    );
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("tv: writes one srt per episode file in a season pack", async () => {
    const files = [
      { path: path.join(TV_NAME, "Severance.S01E01.1080p.WEB.h264.mkv"), length: 300 * MB },
      { path: path.join(TV_NAME, "Severance.S01E02.1080p.WEB.h264.mkv"), length: 300 * MB },
    ];
    const dir = await makeDir(files);
    const fetchImpl = router([
      ["/shows/search/", tvShows],
      ["/subtitles/get/sev-1/1/1/en", () => tvSubs("/subtitles/download/ep1")],
      ["/subtitles/get/sev-1/1/2/en", () => tvSubs("/subtitles/download/ep2")],
      ["/subtitles/download/ep1", () => new Response(SRT)],
      ["/subtitles/download/ep2", () => new Response(SRT)],
    ]);

    const count = await fetchSubtitlesForDownload({
      name: TV_NAME,
      dir,
      source: "eztv",
      files,
      lang: "en",
      fetchImpl,
    });

    expect(count).toBe(2);
    expect(await exists(path.join(dir, TV_NAME, "Severance.S01E01.1080p.WEB.h264.en.srt"))).toBe(
      true,
    );
    expect(await exists(path.join(dir, TV_NAME, "Severance.S01E02.1080p.WEB.h264.en.srt"))).toBe(
      true,
    );
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("classify-null (games source): null, zero writes and zero fetch calls", async () => {
    const files = [{ path: "Elden.Ring.2022/setup.mkv", length: 900 * MB }];
    const dir = await makeDir(files);
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const count = await fetchSubtitlesForDownload({
      name: "Elden.Ring.2022.Repack",
      dir,
      source: "fitgirl",
      files,
      lang: "en",
      fetchImpl,
    });

    expect(count).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(path.join(dir, "Elden.Ring.2022", "setup.en.srt"))).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("no qualifying video files: null without any fetch (nothing to subtitle)", async () => {
    const files = [
      { path: path.join(TV_NAME, "sample.mkv"), length: 20 * MB },
      { path: path.join(TV_NAME, "info.nfo"), length: 300 * MB },
    ];
    const dir = await makeDir(files);
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const count = await fetchSubtitlesForDownload({
      name: TV_NAME,
      dir,
      source: "eztv",
      files,
      lang: "en",
      fetchImpl,
    });

    expect(count).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("tv: one episode's provider failure does not block the other", async () => {
    const files = [
      { path: path.join(TV_NAME, "Severance.S01E01.1080p.WEB.h264.mkv"), length: 300 * MB },
      { path: path.join(TV_NAME, "Severance.S01E02.1080p.WEB.h264.mkv"), length: 300 * MB },
    ];
    const dir = await makeDir(files);
    const fetchImpl = router([
      ["/shows/search/", tvShows],
      ["/subtitles/get/sev-1/1/1/en", () => new Response("boom", { status: 500 })],
      ["/subtitles/get/sev-1/1/2/en", () => tvSubs("/subtitles/download/ep2")],
      ["/subtitles/download/ep2", () => new Response(SRT)],
    ]);

    const count = await fetchSubtitlesForDownload({
      name: TV_NAME,
      dir,
      source: "eztv",
      files,
      lang: "en",
      fetchImpl,
    });

    expect(count).toBe(1);
    expect(await exists(path.join(dir, TV_NAME, "Severance.S01E01.1080p.WEB.h264.en.srt"))).toBe(
      false,
    );
    expect(await exists(path.join(dir, TV_NAME, "Severance.S01E02.1080p.WEB.h264.en.srt"))).toBe(
      true,
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
});
