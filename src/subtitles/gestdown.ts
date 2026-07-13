import { BROWSER_UA, FETCH_TIMEOUT_MS } from "./fetchSubtitle";
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

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

async function getJson<T>(url: string, fetchImpl: typeof fetch): Promise<T | null> {
  const res = await fetchImpl(url, {
    headers: { "user-agent": BROWSER_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
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
    const want = norm(title);
    const show =
      shows.find((s) => norm(s.name) === want) ??
      shows.find((s) => norm(s.name).startsWith(want));
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
        releaseName: `${show.name}.${se}.${s.qualities.join(".")}.${s.version}`,
        lang,
        downloadUrl: BASE + s.downloadUri,
      }));
  } catch {
    return [];
  }
}
