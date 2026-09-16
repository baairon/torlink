export interface NormalizedSearchResult {
  infoHash: string;
  title: string;
  seeders: number;
  sizeBytes: number;
  torrentUrl: string;
  source?: string;
  rawTitle?: string;
}

export interface RankedSearchResult extends NormalizedSearchResult {
  score: number;
  match: {
    ok: boolean;
    ratio: number;
    queryTokens: string[];
    titleTokens: string[];
  };
}

export interface RankOptions {
  maxSizeBytes: number;
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "bd",
  "blu",
  "bluray",
  "brrip",
  "cam",
  "complete",
  "ddp",
  "digital",
  "dolby",
  "dub",
  "dvdrip",
  "episode",
  "episodes",
  "hdr",
  "hevc",
  "h264",
  "h265",
  "hdrip",
  "internal",
  "limited",
  "mkv",
  "mp4",
  "proper",
  "repack",
  "remastered",
  "season",
  "subs",
  "tc",
  "the",
  "uhd",
  "webrip",
  "web",
  "x264",
  "x265",
  "1080p",
  "720p",
  "2160p",
  "480p",
  "480i",
  "5.1",
  "7.1",
]);

const META_TOKENS = new Set([
  "ac3",
  "aac",
  "av1",
  "blu",
  "bluray",
  "brrip",
  "cam",
  "complete",
  "ddp",
  "digital",
  "dub",
  "dvdrip",
  "encoded",
  "extended",
  "hdr",
  "hevc",
  "hdrip",
  "imax",
  "internal",
  "limited",
  "proper",
  "repack",
  "remastered",
  "remux",
  "repack",
  "season",
  "web",
  "webrip",
  "x264",
  "x265",
]);

function splitTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, " ")
    .replace(/[\[\]().,_\-+/|:]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeTokens(value: string): string[] {
  return splitTokens(value).filter((tok) => !STOPWORDS.has(tok));
}

function normalizedPhrase(value: string): string {
  return normalizeTokens(value).join(" ");
}

function isMetadataToken(tok: string): boolean {
  return META_TOKENS.has(tok) || /^\d{4}$/.test(tok) || /^\d+(?:p|k)$/.test(tok);
}

function tokenSet(tokens: string[]): Set<string> {
  return new Set(tokens);
}

function titleMatch(
  query: string,
  queryTokens: string[],
  title: string,
  titleTokens: string[],
): { ok: boolean; ratio: number; phrase: boolean } {
  if (queryTokens.length === 0 || titleTokens.length === 0) return { ok: false, ratio: 0 };
  const titleSet = tokenSet(titleTokens);
  let hits = 0;
  for (const tok of queryTokens) {
    if (titleSet.has(tok)) hits++;
  }
  const ratio = hits / queryTokens.length;
  const queryPhrase = normalizedPhrase(query);
  const titlePhrase = normalizedPhrase(title);
  const phrase = titlePhrase.includes(queryPhrase);
  const tail = titleTokens.slice(queryTokens.length);
  const tailAcceptable = tail.length === 0 || tail.every(isMetadataToken);
  return { ok: (phrase && tailAcceptable) || (ratio >= 0.85 && tailAcceptable), ratio, phrase };
}

function compare(a: RankedSearchResult, b: RankedSearchResult): number {
  if (b.match.phrase !== a.match.phrase) return Number(b.match.phrase) - Number(a.match.phrase);
  if (b.match.ratio !== a.match.ratio) return b.match.ratio - a.match.ratio;
  if (b.seeders !== a.seeders) return b.seeders - a.seeders;
  if (b.sizeBytes !== a.sizeBytes) return b.sizeBytes - a.sizeBytes;
  return a.title.localeCompare(b.title);
}

export function normalizeSearchResult(input: {
  infoHash: string;
  title: string;
  seeders?: number;
  sizeBytes?: number;
  torrentUrl: string;
  source?: string;
}): NormalizedSearchResult {
  return {
    infoHash: input.infoHash.toLowerCase(),
    title: input.title.trim(),
    seeders: Number.isFinite(input.seeders ?? NaN) ? Math.max(0, Math.floor(input.seeders ?? 0)) : 0,
    sizeBytes: Number.isFinite(input.sizeBytes ?? NaN) ? Math.max(0, Math.floor(input.sizeBytes ?? 0)) : 0,
    torrentUrl: input.torrentUrl,
    source: input.source,
    rawTitle: input.title,
  };
}

export function rankSearchResults(
  query: string,
  results: NormalizedSearchResult[],
  opts: RankOptions,
): RankedSearchResult[] {
  const qTokens = normalizeTokens(query);
  const out = results
    .map((r) => {
      const titleTokens = normalizeTokens(r.title);
      const match = titleMatch(query, qTokens, r.title, titleTokens);
      return {
        ...r,
        score: 0,
        match: {
          ok: match.ok,
          ratio: match.ratio,
          queryTokens: qTokens,
          titleTokens,
        },
      };
    })
    .filter((r) => r.sizeBytes > 0 && r.sizeBytes <= opts.maxSizeBytes && r.torrentUrl && r.match.ok);

  out.sort(compare);
  return out.map((r, idx) => ({ ...r, score: out.length - idx }));
}

export function isAcceptableSearchResult(
  query: string,
  result: NormalizedSearchResult,
  opts: RankOptions,
): boolean {
  return rankSearchResults(query, [result], opts).length > 0;
}
