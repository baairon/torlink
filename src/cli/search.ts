import type { SearchCategory } from "./args";
import { cachedSearch } from "../sources/cache";
import { SOURCES, sourcesByGroup } from "../sources/registry";
import { dedupe, defaultOrder } from "../sources/results";
import type { Source, SourceGroup, SourceId, TorrentResult } from "../sources/types";
import { HttpError } from "../util/net";

type OutputCategory = SearchCategory | "all";

interface SourceOutcome {
  ok: boolean;
  count: number;
  error: string | null;
  code: string | null;
}

export interface SearchDocument {
  query: string;
  category: OutputCategory;
  count: number;
  sources: Partial<Record<SourceId, SourceOutcome>>;
  results: TorrentResult[];
}

export interface SearchExecution {
  document: SearchDocument;
  exitCode: 0 | 1;
}

const GROUPS: Record<SearchCategory, SourceGroup> = {
  games: "Games",
  movies: "Movies",
  tv: "TV",
  anime: "Anime",
};

function selectSources(category: OutputCategory): readonly Source[] {
  if (category === "all") return SOURCES;
  return sourcesByGroup().find(({ group }) => group === GROUPS[category])?.sources ?? [];
}

function errorCode(error: unknown): string {
  if (error instanceof HttpError && error.status > 0) return `HTTP ${error.status}`;
  return "no response";
}

export async function runSearch(options: {
  query: string;
  category?: SearchCategory;
  signal?: AbortSignal;
}): Promise<SearchExecution> {
  const category = options.category ?? "all";
  const attempts = await Promise.all(
    selectSources(category).map(async (source) => {
      try {
        const results = await cachedSearch(source, options.query, { signal: options.signal });
        return {
          source,
          results,
          outcome: {
            ok: true,
            count: results.length,
            error: null,
            code: null,
          } satisfies SourceOutcome,
        };
      } catch (error) {
        return {
          source,
          results: [] as TorrentResult[],
          outcome: {
            ok: false,
            count: 0,
            error: error instanceof Error ? error.message : String(error),
            code: errorCode(error),
          } satisfies SourceOutcome,
        };
      }
    }),
  );

  const sources: Partial<Record<SourceId, SourceOutcome>> = {};
  const collected: TorrentResult[] = [];
  for (const attempt of attempts) {
    sources[attempt.source.id] = attempt.outcome;
    collected.push(...attempt.results);
  }

  const results = defaultOrder(dedupe(collected));
  return {
    document: {
      query: options.query,
      category,
      count: results.length,
      sources,
      results,
    },
    exitCode: attempts.some(({ outcome }) => outcome.ok) ? 0 : 1,
  };
}
