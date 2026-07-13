import { basename, dirname, extname, join } from "node:path";
import type { SourceId } from "../sources/types";
import { downloadSubtitle } from "./fetchSubtitle";
import { searchTv } from "./gestdown";
import { isVideoFile, parseRelease } from "./parse";
import { pickBest } from "./score";
import { classifyForSubtitles } from "./trigger";
import { searchMovie } from "./ytssubs";

// Files below this are samples/extras, never the actual movie or episode.
const MIN_VIDEO_BYTES = 50 * 1024 * 1024;

function srtPath(dir: string, videoPath: string, lang: string): string {
  const base = basename(videoPath, extname(videoPath));
  return join(dir, dirname(videoPath), `${base}.${lang}.srt`);
}

// Best-effort: never throws, returns how many .srt files were written.
// null = never searched (not subtitle-applicable / nothing to subtitle),
// 0 = searched and found nothing — callers must not warn on null.
export async function fetchSubtitlesForDownload(opts: {
  name: string;
  dir: string;
  source?: SourceId;
  files: { path: string; length: number }[];
  lang: string;
  fetchImpl?: typeof fetch;
}): Promise<number | null> {
  const { name, dir, source, files, lang, fetchImpl = fetch } = opts;
  const kind = classifyForSubtitles(source, name);
  if (!kind) return null;
  const videos = files.filter((f) => isVideoFile(f.path) && f.length >= MIN_VIDEO_BYTES);
  if (videos.length === 0) return null;

  if (kind === "movie") {
    try {
      const target = videos.reduce((a, b) => (b.length > a.length ? b : a));
      const parsed = parseRelease(name);
      const candidates = await searchMovie(parsed.title, parsed.year, lang, fetchImpl);
      const best = pickBest(parsed, candidates, lang);
      if (!best) return 0;
      return (await downloadSubtitle(best, srtPath(dir, target.path, lang), fetchImpl)) ? 1 : 0;
    } catch {
      return 0;
    }
  }

  const torrentTitle = parseRelease(name).title;
  let count = 0;
  // Sequential on purpose: one show, polite to the provider, and one file's
  // failure must never abort the rest.
  for (const f of videos) {
    try {
      const p = parseRelease(basename(f.path));
      if (p.season === undefined || p.episode === undefined) continue;
      const title = p.title || torrentTitle;
      const candidates = await searchTv(title, p.season, p.episode, lang, fetchImpl);
      const best = pickBest({ ...p, title }, candidates, lang);
      if (best && (await downloadSubtitle(best, srtPath(dir, f.path, lang), fetchImpl))) {
        count++;
      }
    } catch {}
  }
  return count;
}
