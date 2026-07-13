import { BROWSER_UA, FETCH_TIMEOUT_MS } from "./fetchSubtitle";
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

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getHtml(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  const res = await fetchImpl(url, {
    headers: { "user-agent": BROWSER_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return res.text();
}

// The pages arrive as one long line, so rows are found by splitting on their
// anchors rather than line-based matching.
function findImdbId(html: string, title: string, year: number | undefined): string | null {
  const want = norm(title);
  for (const seg of html.split('href="/movie-imdb/').slice(1)) {
    const id = seg.match(/^(tt\d+)"/)?.[1];
    const heading = seg.match(/<h3 class="media-heading">([^<]*)<\/h3>/)?.[1];
    if (!id || !heading || norm(heading) !== want) continue;
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
