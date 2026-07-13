import { fetchResilient } from "../util/net";
import { BROWSER_UA, FETCH_TIMEOUT_MS, readCapped } from "./fetchSubtitle";
import { normalizeTitle } from "./parse";
import type { SubtitleCandidate } from "./types";

const BASE = "https://api.gestdown.info";

interface GdShow {
  id: string;
  name: string;
}

interface GdSubtitle {
  version: string;
  completed: boolean;
  downloadUri: string;
  qualities: string[];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

async function getJson<T>(url: string, fetchImpl: typeof fetch): Promise<T | null> {
  // retries: 1 keeps this background hook polite to the subtitle hosts.
  const res = await fetchResilient(url, {
    headers: { "user-agent": BROWSER_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    retries: 1,
    fetchImpl,
  });
  if (!res.ok) return null;
  const buf = await readCapped(res);
  if (!buf) return null;
  return JSON.parse(buf.toString("utf8")) as T;
}

export async function searchTv(
  title: string,
  season: number,
  episode: number,
  lang: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SubtitleCandidate[]> {
  try {
    const found = await getJson<{ shows?: GdShow[] }>(
      `${BASE}/shows/search/${encodeURIComponent(title)}`,
      fetchImpl,
    );
    const shows = found?.shows ?? [];
    const want = normalizeTitle(title);
    const show =
      shows.find((s) => normalizeTitle(s.name) === want) ??
      shows.find((s) => normalizeTitle(s.name).startsWith(want));
    if (!show) return [];

    const subs = await getJson<{ matchingSubtitles?: GdSubtitle[] }>(
      `${BASE}/subtitles/get/${show.id}/${season}/${episode}/${lang}`,
      fetchImpl,
    );
    if (!subs) return [];

    // Gestdown has no release name; synthesize one so the scorer can gate on
    // title+episode and score resolution/group.
    const se = `S${pad2(season)}E${pad2(episode)}`;
    return (subs.matchingSubtitles ?? [])
      .filter((s) => s.completed)
      .map((s) => ({
        // Hyphen before the version: parseRelease only reads a release group
        // off a "-GROUP" tail, and pickBest's top weight rides on it.
        releaseName: `${show.name}.${se}.${s.qualities.join(".")}-${s.version}`,
        lang,
        downloadUrl: BASE + s.downloadUri,
      }));
  } catch {
    return [];
  }
}
