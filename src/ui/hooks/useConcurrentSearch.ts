import { useEffect, useState } from "react";
import { SOURCES } from "../../sources/registry";
import { cachedSearch } from "../../sources/cache";
import { HttpError } from "../../util/net";
import type { Source, SourceId, TorrentResult } from "../../sources/types";

export interface SourceState {
  loading: boolean;
  error: string | null;
  code: string | null;
  count: number;
}

function errorCode(e: unknown): string {
  if (e instanceof HttpError && e.status > 0) return `HTTP ${e.status}`;
  return "no response";
}

export interface ConcurrentSearchState {
  results: TorrentResult[];
  perSource: Record<SourceId, SourceState>;
  loading: boolean;
  done: number;
  total: number;
}

function blankPerSource(
  loading: boolean,
  sources: readonly Source[],
): Record<SourceId, SourceState> {
  const out = {} as Record<SourceId, SourceState>;
  for (const s of sources) out[s.id] = { loading, error: null, code: null, count: 0 };
  return out;
}

function dedupe(list: TorrentResult[]): TorrentResult[] {
  const byHash = new Map<string, TorrentResult>();
  for (const r of list) {
    const existing = byHash.get(r.infoHash);
    if (!existing || r.seeders > existing.seeders) byHash.set(r.infoHash, r);
  }
  return [...byHash.values()];
}

// torlink's default ordering: healthiest first. The results view can re-sort
// on demand (the `s` key), and its "none"/default state preserves this order.
function defaultOrder(list: TorrentResult[]): TorrentResult[] {
  return list.sort((a, b) => {
    if (b.seeders !== a.seeders) return b.seeders - a.seeders;
    return (b.added ?? 0) - (a.added ?? 0);
  });
}

function idleState(sources: readonly Source[]): ConcurrentSearchState {
  return {
    results: [],
    perSource: blankPerSource(false, sources),
    loading: false,
    done: 0,
    total: sources.length,
  };
}

// Coalesce interval for streaming result updates. Sources finish in bursts (a
// cache hit or a couple of fast hosts land almost together), and each update
// re-sorts and re-renders the whole list. Flushing at most once per this window
// keeps a burst from flooding Ink with re-renders and blocking stdin — the same
// leading-throttle the queue hooks in store.ts use for `update` events.
const RESULT_FLUSH_MS = 150;

/**
 * Searches `sources` for `query`, streaming results in as each one answers.
 *
 * The caller passes the active tab's sources rather than the whole registry: a
 * category tab renders its own group and nothing else, so querying the rest is
 * work no one sees — and every source added from here on would otherwise cost
 * every search another request. Defaults to the whole registry, which is what
 * the All tab wants.
 *
 * Switching tabs re-runs the search, but cachedSearch holds each source+query
 * for five minutes, so a tab already visited answers without touching the
 * network.
 */
export function useConcurrentSearch(
  query: string,
  sources: readonly Source[] = SOURCES,
): ConcurrentSearchState {
  // The array identity changes on every render (the caller derives it from the
  // active tab), so the effect keys off the ids instead. Same tab, same key,
  // no re-search.
  const sourceKey = sources.map((s) => s.id).join(",");
  const [state, setState] = useState<ConcurrentSearchState>(() => idleState(sources));

  useEffect(() => {
    const ctrl = new AbortController();
    let alive = true;
    const collected: TorrentResult[] = [];
    const per = blankPerSource(true, sources);
    let done = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = (): void => {
      setState({
        results: defaultOrder(dedupe(collected.slice())),
        perSource: { ...per },
        loading: done < sources.length,
        done,
        total: sources.length,
      });
    };

    // Push the accumulated state to the UI, but no more than once per window.
    // The final source flushes immediately so "done" / loading:false is prompt.
    const scheduleFlush = (): void => {
      if (done >= sources.length) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        flush();
        return;
      }
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (alive) flush();
      }, RESULT_FLUSH_MS);
    };

    setState({
      results: [],
      perSource: { ...per },
      loading: true,
      done: 0,
      total: sources.length,
    });

    for (const source of sources) {
      cachedSearch(source, query, { signal: ctrl.signal })
        .then((res) => {
          if (!alive) return;
          collected.push(...res);
          per[source.id] = { loading: false, error: null, code: null, count: res.length };
        })
        .catch((e: unknown) => {
          if (!alive || ctrl.signal.aborted) return;
          per[source.id] = {
            loading: false,
            error: e instanceof Error ? e.message : String(e),
            code: errorCode(e),
            count: 0,
          };
        })
        .finally(() => {
          if (!alive) return;
          done += 1;
          scheduleFlush();
        });
    }

    return () => {
      alive = false;
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
    // sources is read through sourceKey, which is what actually identifies it.
  }, [query, sourceKey]);

  return state;
}
