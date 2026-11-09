import type { SearchOptions, Source, TorrentResult } from "./types";

function normalize(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// One adjacent transposition, insertion, deletion or substitution. Keep short
// words exact (apart from transpositions) to avoid turning Dune into Duke.
function nearWord(query: string, word: string): boolean {
  if (query === word) return true;
  if (/\d/u.test(query) || /\d/u.test(word)) return false;
  if (query.length >= 3 && word.startsWith(query)) return true;
  if (Math.abs(query.length - word.length) > 1) return false;
  let i = 0;
  while (i < query.length && query[i] === word[i]) i++;
  if (query.length === word.length && query.length >= 4 &&
      query[i] === word[i + 1] && query[i + 1] === word[i] &&
      query.slice(i + 2) === word.slice(i + 2)) return true;
  if (Math.min(query.length, word.length) < 5) return false;
  if (query.length === word.length) return query.slice(i + 1) === word.slice(i + 1);
  return query.length > word.length
    ? query.slice(i + 1) === word.slice(i)
    : query.slice(i) === word.slice(i + 1);
}

export function matchesTitle(query: string, title: string): boolean {
  const q = normalize(query);
  if (!q) return false;
  const name = normalize(title);
  const tokens = q.split(" ");
  // Also allow merged words, e.g. SuperTuxKart / super tux kart. Numbers
  // still need token matching so "Dune 2" cannot match "Dune (2021)".
  if (!/\d/u.test(q) && q.replaceAll(" ", "").length >= 4 &&
      name.replaceAll(" ", "").includes(q.replaceAll(" ", ""))) return true;
  const words = name.split(" ");
  return tokens.every((token) => words.some((word) => nearWord(token, word)));
}

const STOP_WORDS = new Set(["a", "an", "the", "of", "and", "in", "on", "to", "for"]);

function fallbackQueries(query: string): string[] {
  const normalized = normalize(query);
  const tokens = normalized.split(" ").filter(Boolean);
  const anchors = tokens.length > 1
    ? [...new Set(tokens)].filter((token) => token.length >= 3 &&
        !/^\d+$/u.test(token) && !STOP_WORDS.has(token))
        .sort((a, b) => b.length - a.length).slice(0, 2)
    : [];
  return [...new Set([normalized, ...anchors])]
    .filter((q) => q && q !== query.trim().toLowerCase());
}

// Source APIs generally search literally. Only broaden an empty answer, and
// keep fallback rows only when the full query matches their title. At most
// three extra source calls; successful searches and the browse feed stay put.
export async function searchWithFallback(
  source: Source,
  query: string,
  opts: SearchOptions = {},
): Promise<TorrentResult[]> {
  const results = await source.search(query, opts);
  if (results.length || !query.trim()) return results;
  for (const fallback of fallbackQueries(query)) {
    if (opts.signal?.aborted) break;
    try {
      const candidates = await source.search(fallback, opts);
      const matches = candidates.filter((row) => matchesTitle(query, row.name));
      if (matches.length) return matches;
    } catch {
      // The original request succeeded. Optional recovery must not turn its
      // empty answer into a failed source when a broader request is blocked.
    }
  }
  return results;
}
