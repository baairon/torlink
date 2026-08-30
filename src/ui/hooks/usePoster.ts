import { useEffect, useState } from "react";
import { decodePoster } from "../../meta/image";
import { fetchPosterBytes } from "../../meta/poster";
import type { PosterCells } from "../../meta/image";

export interface PosterState {
  loading: boolean;
  cells: PosterCells | null;
}

// Same shape as sources/cache.ts and meta/lookup.ts: a module-level Map, a TTL constant, a key
// helper, no eviction and no persistence. What is cached is the *decoded* cell grid, not the JPEG
// bytes — the decode is the expensive half and it is synchronous, so re-selecting a row the user
// already looked at must not pay for it twice.
//
// The key carries the cell budget as well as the URL because the same poster at a different pane
// size is a different picture; a resize retires the old entry by simply never asking for it again.
const TTL_MS = 30 * 60 * 1000;

// A miss here is as ambiguous as it is in lookup.ts — a dead network, a CDN 404 and a WebP body
// all arrive as the same null — so it is parked for minutes rather than for the session, and a
// poster that was merely unlucky comes back once the network does.
const NEGATIVE_TTL_MS = 2 * 60 * 1000;

interface Entry {
  at: number;
  cells: PosterCells | null;
}

const cache = new Map<string, Entry>();

function key(url: string, cols: number, rows: number): string {
  return `${url}::${cols}x${rows}`;
}

function peek(k: string): PosterCells | null | undefined {
  const hit = cache.get(k);
  if (hit === undefined) return undefined;
  const ttl = hit.cells === null ? NEGATIVE_TTL_MS : TTL_MS;
  return Date.now() - hit.at < ttl ? hit.cells : undefined;
}

const IDLE: PosterState = { loading: false, cells: null };

/**
 * Poster art for a URL at a given cell budget, fetched lazily and dropped the moment the row stops
 * being interesting.
 *
 * No debounce of its own: `useResultMeta` has already waited out the user's scrolling before it
 * produced the metadata that carries this URL, so by the time there is anything to fetch the
 * cursor has settled. `enabled` mirrors that hook so the caller can keep it mounted (hooks cannot
 * be called conditionally) while the pane has no room for art.
 */
export function usePoster(
  url: string | undefined,
  cols: number,
  rows: number,
  enabled: boolean,
): PosterState {
  const [state, setState] = useState<PosterState>(IDLE);

  useEffect(() => {
    if (!enabled || url === undefined || cols < 1 || rows < 1) {
      setState(IDLE);
      return;
    }

    const k = key(url, cols, rows);
    // Synchronous read first, so scrolling back onto a row redraws its art in the same frame the
    // text card returns instead of blinking through a second empty pass.
    const cached = peek(k);
    if (cached !== undefined) {
      setState({ loading: false, cells: cached });
      return;
    }

    setState({ loading: true, cells: null });

    let alive = true;
    const ctrl = new AbortController();
    void fetchPosterBytes(url, { signal: ctrl.signal })
      .then((bytes) => {
        // Decoding blocks the event loop, so a response for a row the cursor has already left is
        // dropped before the decode rather than after it.
        if (!alive) return;
        const cells = bytes === null ? null : decodePoster(bytes, cols, rows);
        cache.set(k, { at: Date.now(), cells });
        setState({ loading: false, cells });
      })
      .catch(() => {
        // fetchPosterBytes and decodePoster both swallow their own failures. Belt and braces: an
        // unhandled rejection out of a render path is a crashed TUI.
        if (alive) setState(IDLE);
      });

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [url, cols, rows, enabled]);

  return state;
}
