import { useEffect, useState } from "react";
import { useStdout } from "ink";
import { widenPosterUrl } from "../../meta/cinemeta";
import { decodePoster } from "../../meta/image";
import {
  decodeGraphicsPoster,
  idColor,
  nextImageId,
  placeholderLines,
  transmitChunks,
  writeChunks,
} from "../../meta/kittyGraphics";
import { fetchPosterBytes } from "../../meta/poster";
import { getGraphicsTier } from "../graphics";
import type { GraphicsCells, PosterArt } from "../../meta/image";
import type { GraphicsTier } from "../graphics";

export interface PosterState {
  loading: boolean;
  cells: PosterArt | null;
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
  cells: PosterArt | null;
}

const cache = new Map<string, Entry>();

// The tier is part of the key as much as the budget is: a half-block grid served into a kitty
// session would draw a mosaic where the picture should be, and placeholders served into a terminal
// that cannot resolve them draw nothing at all. The tier cannot change inside a process, so this
// only ever costs a longer string — but it is the difference between "cannot happen" and "does not
// happen to today".
function key(url: string, cols: number, rows: number, tier: GraphicsTier): string {
  return `${tier ?? "blocks"}::${url}::${cols}x${rows}`;
}

function peek(k: string): PosterArt | null | undefined {
  const hit = cache.get(k);
  if (hit === undefined) return undefined;
  const ttl = hit.cells === null ? NEGATIVE_TTL_MS : TTL_MS;
  return Date.now() - hit.at < ttl ? hit.cells : undefined;
}

const IDLE: PosterState = { loading: false, cells: null };

/**
 * The poster as a picture the terminal draws itself, transmitted on the way out, or null for every
 * reason there is not to.
 *
 * The transmission goes to the stream *before* this returns, so it is on the wire before the state
 * update that paints the placeholders addressing it — Node orders writes on a stream, and that
 * ordering is the whole synchronisation between the two halves of this tier.
 */
function graphicsArt(
  bytes: Uint8Array,
  cols: number,
  rows: number,
  out: NodeJS.WriteStream,
): GraphicsCells | null {
  const image = decodeGraphicsPoster(bytes, cols, rows);
  if (image === null) return null;
  const imageId = nextImageId();
  const lines = placeholderLines(imageId, image.cols, image.rows);
  if (lines === null) return null;
  const chunks = transmitChunks(imageId, image);
  if (chunks.length === 0) return null;
  writeChunks(out, chunks);
  return { cols: image.cols, rows: image.rows, lines, color: idColor(imageId), imageId };
}

/**
 * Bytes to whatever art this terminal can draw.
 *
 * Every refusal on the graphics side — a decode that failed, a picture past the diacritic table, a
 * payload over the wire budget — falls through to the half-block grid, so the tier can only add
 * fidelity and never cost the poster.
 */
function prepareArt(
  bytes: Uint8Array,
  cols: number,
  rows: number,
  tier: GraphicsTier,
  out: NodeJS.WriteStream,
): PosterArt | null {
  const native = tier === "kitty" ? graphicsArt(bytes, cols, rows, out) : null;
  return native ?? decodePoster(bytes, cols, rows);
}

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
  // Ink's own output stream rather than process.stdout: the transmission has to land on the same
  // stream the placeholders are painted on, and under the previews script and the test harness
  // that is not the process's.
  const { stdout } = useStdout();

  useEffect(() => {
    if (!enabled || url === undefined || cols < 1 || rows < 1) {
      setState(IDLE);
      return;
    }

    // Read once, here, rather than at module scope: the tier is set during startup, and a module
    // read would bake in whatever it was when this file was first imported.
    const tier = getGraphicsTier();
    const k = key(url, cols, rows, tier);
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
    // A native image is drawn at roughly eight pixels a column, so the thumbnail rendition that is
    // right for half-blocks would be a visible upscale. Same poster, bigger source.
    const src = tier === "kitty" ? widenPosterUrl(url) : url;
    void fetchPosterBytes(src, { signal: ctrl.signal })
      .then((bytes) => {
        // Decoding blocks the event loop, so a response for a row the cursor has already left is
        // dropped before the decode rather than after it — and before it is transmitted, which
        // would otherwise put a picture nobody is looking at in the terminal's store.
        if (!alive) return;
        const cells = bytes === null ? null : prepareArt(bytes, cols, rows, tier, stdout);
        cache.set(k, { at: Date.now(), cells });
        setState({ loading: false, cells });
      })
      .catch(() => {
        // fetchPosterBytes, both decoders and writeChunks all swallow their own failures. Belt and
        // braces: an unhandled rejection out of a render path is a crashed TUI.
        if (alive) setState(IDLE);
      });

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [url, cols, rows, enabled, stdout]);

  return state;
}
