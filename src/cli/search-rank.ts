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

const SEQUEL_TOKENS = new Set([
  "part",
  "pt",
  "episode",
  "chapter",
  "volume",
  "vol",
  "book",
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
  "vii",
  "viii",
  "ix",
  "x",
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

function isSequelToken(tok: string): boolean {
  return SEQUEL_TOKENS.has(tok) || /^\d+$/.test(tok);
}

function canonicalToken(tok: string): string {
  if (/^\d+$/.test(tok)) return tok;
  switch (tok) {
    case "i":
      return "1";
    case "ii":
      return "2";
    case "iii":
      return "3";
    case "iv":
      return "4";
    case "v":
      return "5";
    case "vi":
      return "6";
    case "vii":
      return "7";
    case "viii":
      return "8";
    case "ix":
      return "9";
    case "x":
      return "10";
    default:
      return tok;
  }
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
  const queryCanonical = queryTokens.map(canonicalToken);
  const titleCanonical = titleTokens.map(canonicalToken);
  const titleSet = tokenSet(titleCanonical);
  let hits = 0;
  for (const tok of queryCanonical) {
    if (titleSet.has(tok)) hits++;
  }
  const ratio = hits / queryCanonical.length;
  const queryPhrase = normalizedPhrase(query);
  const titlePhrase = normalizedPhrase(title);
  const phrase = titlePhrase.includes(queryPhrase);
  const titleCore = titleTokens.filter((tok) => !isMetadataToken(tok) && !isSequelToken(tok));
  const queryCore = queryTokens.filter((tok) => !isMetadataToken(tok) && !isSequelToken(tok));
  const coreSet = tokenSet(titleCore.map(canonicalToken));
  let coreHits = 0;
  for (const tok of queryCore.map(canonicalToken)) {
    if (coreSet.has(tok)) coreHits++;
  }
  const coreRatio = queryCore.length > 0 ? coreHits / queryCore.length : ratio;
  return { ok: phrase || ratio >= 0.75 || coreRatio >= 0.7, ratio: Math.max(ratio, coreRatio), phrase };
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
