import { useEffect, useRef, useState } from "react";
import { lookupMeta, peekMeta } from "../../meta/lookup";
import type { Meta } from "../../meta/types";
import type { TorrentResult } from "../../sources/types";

export interface MetaState {
  loading: boolean;
  meta: Meta | null;
}

// The user is scrolling a list; every row they pass through is a candidate lookup they did not
// ask for. Waiting this long before firing means holding an arrow key down costs zero requests,
// and a deliberate stop on a row still feels immediate.
const DEBOUNCE_MS = 250;

const IDLE: MetaState = { loading: false, meta: null };

/**
 * Metadata for the currently interesting row, fetched lazily and cancelled the moment it stops
 * being interesting.
 *
 * `enabled` exists so a caller can keep the hook mounted (hooks cannot be called conditionally)
 * while the pane that wants the data is closed.
 */
export function useResultMeta(
  result: TorrentResult | null,
  enabled: boolean,
  debounceMs?: number,
): MetaState {
  const [state, setState] = useState<MetaState>(IDLE);

  // The effect keys on the infoHash, not the row object, so the streaming re-sorts in Results
  // cannot restart a lookup that is already in flight. It still needs the row itself to run the
  // lookup, and reading it through a ref keeps that out of the dependency list — two objects with
  // the same infoHash are the same torrent, so the latest one is always safe to use.
  const latest = useRef(result);
  latest.current = result;

  const infoHash = result?.infoHash;

  useEffect(() => {
    const row = latest.current;
    if (!enabled || row === null || row === undefined) {
      setState(IDLE);
      return;
    }

    // Synchronous cache read first: a row we already resolved (or already know we never will)
    // renders its answer immediately instead of flashing a spinner on every revisit.
    const cached = peekMeta(row);
    if (cached !== undefined) {
      setState({ loading: false, meta: cached });
      return;
    }

    setState({ loading: true, meta: null });

    let alive = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void lookupMeta(row, { signal: ctrl.signal })
        .then((meta) => {
          // The row changed under us while the request was in flight; its state belongs to
          // whichever effect is current, not to this one.
          if (alive) setState({ loading: false, meta });
        })
        .catch(() => {
          // lookupMeta already swallows its own failures. Belt and braces: an unhandled rejection
          // from a render path is a crashed TUI.
          if (alive) setState(IDLE);
        });
    }, debounceMs ?? DEBOUNCE_MS);

    return () => {
      alive = false;
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [infoHash, enabled, debounceMs]);

  return state;
}
