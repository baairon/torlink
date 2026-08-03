import { useEffect, useState } from "react";
import { SOURCES } from "../../sources/registry";
import { cachedSearch } from "../../sources/cache";
import { HttpError } from "../../util/net";
import type { SourceId, TorrentResult } from "../../sources/types";

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

function blankPerSource(loading: boolean): Record<SourceId, SourceState> {
  const out = {} as Record<SourceId, SourceState>;
  for (const s of SOURCES) out[s.id] = { loading, error: null, code: null, count: 0 };
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

function idleState(): ConcurrentSearchState {
  return {
    results: [],
    perSource: blankPerSource(false),
    loading: false,
    done: 0,
    total: SOURCES.length,
  };
}

// Coalesce interval for streaming result updates. Sources finish in bursts (a
// cache hit or a couple of fast hosts land almost together), and each update
// re-sorts and re-renders the whole list. Flushing at most once per this window
// keeps a burst from flooding Ink with re-renders and blocking stdin — the same
// leading-throttle the queue hooks in store.ts use for `update` events.
const RESULT_FLUSH_MS = 150;

export function useConcurrentSearch(query: string): ConcurrentSearchState {
  const [state, setState] = useState<ConcurrentSearchState>(idleState);

  useEffect(() => {
    const ctrl = new AbortController();
    let alive = true;
    const collected: TorrentResult[] = [];
    const per = blankPerSource(true);
    let done = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = (): void => {
      setState({
        results: defaultOrder(dedupe(collected.slice())),
        perSource: { ...per },
        loading: done < SOURCES.length,
        done,
        total: SOURCES.length,
      });
    };

    // Push the accumulated state to the UI, but no more than once per window.
    // The final source flushes immediately so "done" / loading:false is prompt.
    const scheduleFlush = (): void => {
      if (done >= SOURCES.length) {
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
      total: SOURCES.length,
    });

    for (const source of SOURCES) {
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
  }, [query]);

  return state;
}
