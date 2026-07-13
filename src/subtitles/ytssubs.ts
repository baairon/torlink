import { fetchResilient } from "../util/net";
import { BROWSER_UA, FETCH_TIMEOUT_MS, readCapped } from "./fetchSubtitle";
import { normalizeTitle } from "./parse";
import type { SubtitleCandidate } from "./types";

const PAGE_BASE = "https://yts-subs.com";
// Zip downloads live on the sister domain (and need its referer, see
// downloadSubtitle).
const ZIP_BASE = "https://yifysubtitles.ch";

// The site labels rows with full language names; map ISO codes to them.
const LANG_NAMES: Record<string, string> = {
  en: "english",
  he: "hebrew",
  es: "spanish",
  fr: "french",
  de: "german",
  it: "italian",
  pt: "portuguese",
  ar: "arabic",
  ru: "russian",
  nl: "dutch",
  pl: "polish",
  tr: "turkish",
};

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getHtml(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  // retries: 1 keeps this background hook polite to the subtitle hosts.
  const res = await fetchResilient(url, {
    headers: { "user-agent": BROWSER_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    retries: 1,
    fetchImpl,
  });
  if (!res.ok) return null;
  const buf = await readCapped(res);
  return buf ? buf.toString("utf8") : null;
}

// The pages arrive as one long line, so rows are found by splitting on their
// anchors rather than line-based matching.
function findImdbId(html: string, title: string, year: number | undefined): string | null {
  const want = normalizeTitle(title);
  for (const seg of html.split('href="/movie-imdb/').slice(1)) {
    const id = seg.match(/^(tt\d+)"/)?.[1];
    const heading = seg.match(/<h3 class="media-heading"[^>]*>([^<]*)<\/h3>/)?.[1];
    if (!id || !heading || normalizeTitle(heading) !== want) continue;
    if (year !== undefined && !seg.includes(String(year))) continue;
    return id;
  }
  return null;
}

export async function searchMovie(
  title: string,
  year: number | undefined,
  lang: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SubtitleCandidate[]> {
  try {
    const searchHtml = await getHtml(
      `${PAGE_BASE}/search/${encodeURIComponent(title)}`,
      fetchImpl,
    );
    if (!searchHtml) return [];
    const imdbId = findImdbId(searchHtml, title, year);
    if (!imdbId) return [];

    const movieHtml = await getHtml(`${PAGE_BASE}/movie-imdb/${imdbId}`, fetchImpl);
    if (!movieHtml) return [];

    const code = lang.toLowerCase();
    const wantName = LANG_NAMES[code];
    const out: SubtitleCandidate[] = [];
    for (const row of movieHtml.split(/<tr[\s>]/i).slice(1)) {
      const span = row.match(/<span class="sub-lang">([^<]*)<\/span>/i)?.[1]?.trim();
      const anchor = row.match(/<a href="\/subtitles\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!span || !anchor) continue;
      const spanLower = span.toLowerCase();
      if (wantName ? spanLower !== wantName : !spanLower.startsWith(code)) continue;
      const slug = anchor[1]!.split("/").pop()!;
      const caption = stripTags(anchor[2]!).replace(/^subtitle\s+/i, "");
      out.push({
        releaseName: caption || slug.replace(/-/g, "."),
        lang,
        downloadUrl: `${ZIP_BASE}/subtitle/${slug}.zip`,
      });
    }
    return out;
  } catch {
    return [];
  }
}
