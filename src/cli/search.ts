import type { SearchCategory } from "./args";
import { cachedSearch } from "../sources/cache";
import { SOURCES, sourcesByGroup } from "../sources/registry";
import { dedupeResults } from "../ui/dedupe";
import { defaultOrder } from "../ui/sort";
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

// Every source is asked at once and the document prints only when the last one
// settles, so without a bound the slowest source decides how long a caller
// waits. A host that goes silent can hold a request for minutes before fetch
// gives up on it, and each source retries on top of that.
export const DEFAULT_SEARCH_TIMEOUT_MS = 45_000;

// How long a source gets to settle once the deadline has aborted its requests.
// One that honors the signal is done within a tick; this only stops one that
// ignores it from holding the document back.
const SETTLE_GRACE_MS = 1_000;

// setTimeout treats any longer delay as 1ms, which would turn a huge timeout
// into an instant one.
const MAX_TIMER_MS = 2 ** 31 - 1;

const CUT_OFF = Symbol("cut off");

export async function runSearch(options: {
  query: string;
  category?: SearchCategory;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<SearchExecution> {
  const category = options.category ?? "all";
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS, MAX_TIMER_MS);

  // Only the deadline aborts this controller, so its state tells a timeout
  // apart from a caller cancelling the search through its own signal.
  const deadline = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal;

  let cut: (value: typeof CUT_OFF) => void = () => {};
  const cutOff = new Promise<typeof CUT_OFF>((resolve) => {
    cut = resolve;
  });
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const deadlineTimer = setTimeout(() => {
    deadline.abort();
    graceTimer = setTimeout(() => cut(CUT_OFF), SETTLE_GRACE_MS);
  }, timeoutMs);

  const timedOut = (source: Source) => ({
    source,
    results: [] as TorrentResult[],
    outcome: {
      ok: false,
      count: 0,
      error: `timed out after ${timeoutMs / 1000}s`,
      code: "timeout",
    } satisfies SourceOutcome,
  });

  const attempts = await Promise.all(
    selectSources(category).map(async (source) => {
      try {
        const results = await Promise.race([
          cachedSearch(source, options.query, { signal }),
          cutOff,
        ]);
        // A source cut short may still hand back what it already had (its
        // deeper pages are best-effort), and that is worth keeping. An empty
        // answer after the deadline is not a search with no matches, though:
        // 1337x drops every row whose detail page it could not fetch.
        if (results === CUT_OFF || (deadline.signal.aborted && results.length === 0)) {
          return timedOut(source);
        }
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
        if (deadline.signal.aborted) return timedOut(source);
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
  // A search that finishes early must not leave the deadline pending, or the
  // process would sit idle until it fired.
  clearTimeout(deadlineTimer);
  clearTimeout(graceTimer);

  const sources: Partial<Record<SourceId, SourceOutcome>> = {};
  const collected: TorrentResult[] = [];
  for (const attempt of attempts) {
    sources[attempt.source.id] = attempt.outcome;
    collected.push(...attempt.results);
  }

  const results = defaultOrder(dedupeResults(collected));
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
