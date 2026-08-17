import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Panel } from "./Panel";
import { Poster } from "./Poster";
import { Spinner } from "./Spinner";
import { usePoster } from "../hooks/usePoster";
import { useResultMeta } from "../hooks/useResultMeta";
import { scrollStart } from "../move";
import { planPaneLines } from "../paneCard";
import { posterBudget } from "../previewLayout";
import { COLOR, ICON } from "../theme";
import type { PosterCells } from "../../meta/image";
import type { TorrentResult } from "../../sources/types";

/**
 * The live card beside the results list: what the row under the cursor actually is, without the
 * user opening anything.
 *
 * It owns its own lookup rather than being handed one, so the pane is the only thing that decides
 * when a row is worth a request — mounting it starts one, closing it (the `i` key, or a terminal
 * too narrow for the split) stops it. The lookup keeps the hook's default debounce: holding an
 * arrow key down sweeps past rows the user never asked about, and that delay is what makes those
 * rows free.
 *
 * `poster` is the tier's answer from previewLayout, not a preference: the narrowest split has the
 * columns for art but not enough of them for it to read as a picture, and that call belongs with
 * the widths it was made from.
 *
 * `focused` is the pane holding the keyboard (region "preview"). It is one prop rather than a read
 * of the store because the pane is rendered standalone in its own tests, and because the pane
 * itself has no opinion on what focus means — it is told, and answers with a wider card, a
 * full-size poster and rows that scroll instead of rows that were cut to fit.
 */
export function MetaPane({
  result,
  width,
  height,
  poster,
  focused = false,
}: {
  result: TorrentResult | null;
  width: number;
  height: number;
  poster: boolean;
  focused?: boolean;
}) {
  const { loading, meta } = useResultMeta(result, true);

  // Panel draws its bottom border inside `height` (its title bar is the separate row above), and
  // pads one column each side inside a 1-column border.
  const innerWidth = Math.max(1, width - 4);
  const innerRows = Math.max(0, height - 1);

  // Two independent vetoes: the tier says whether art belongs at this width at all, posterBudget
  // says whether this pane has the rows for it. Both have to agree before a single byte goes over
  // the wire.
  const budget = poster ? posterBudget(width, innerRows, focused) : null;
  const { cells } = usePoster(
    meta?.posterUrl,
    budget?.cols ?? 0,
    budget?.rows ?? 0,
    budget !== null,
  );

  // Art is drawn only once it demonstrably fits the budget it is being drawn into. Cells outgrow
  // their pane for exactly one frame on a resize — the hook re-keys in an effect, so the render
  // that first sees the new width still holds the old grid — and one frame of a too-tall poster is
  // a fused row through Yoga's shrink math, in the pane *and* in the list beside it.
  const art =
    cells !== null && budget !== null && cells.cols <= budget.cols && cells.rows <= budget.rows
      ? cells
      : null;

  // Scroll offset in content rows, owned here because clamping needs the row count only this
  // component knows. A new row is a new card, so it opens at the top — anything else would leave
  // the user reading the middle of a release they just arrived at.
  const rowKey = result?.infoHash ?? null;
  const [scroll, setScroll] = useState(0);
  useEffect(() => {
    setScroll(0);
  }, [rowKey]);

  // The card is laid out around the art that actually rendered, never around art that is merely
  // expected. A poster still in flight, refused by the host sniff or rejected by the decoder
  // therefore leaves the text exactly where it sits without it — no reserved hole, no gap, and no
  // second layout to get wrong. The cost is that the text settles downward once when art lands.
  const artRows = art === null ? 0 : art.rows;
  const head = art === null ? 0 : artRows + 1; // art + the blank row between it and the text
  // Unfocused the card is cut to what is left; focused it is built whole and the window below
  // decides what shows, which is the entire point of being able to focus it.
  const textBudget = focused ? Number.POSITIVE_INFINITY : Math.max(0, innerRows - head);
  // Memoised because the pane re-renders on every search tick and every cursor move, while the
  // word wrapper is linear in the plot — the one field long enough for that to be worth a cache.
  const lines = useMemo(
    () => (meta === null ? [] : planPaneLines(meta, innerWidth, textBudget)),
    [meta, innerWidth, textBudget],
  );
  // One entry per terminal row, so the window can cut inside a wrapped credit.
  const textRows = lines.flatMap((l) =>
    l.text.split("\n").map((text, i) => ({ key: `${l.key}:${i}`, text, tone: l.tone })),
  );

  const total = head + textRows.length;
  // The affordance costs a row, and it only exists when there is something off screen to point
  // at, so the two are resolved together: overflow against the full height, then the window
  // against what the affordance leaves. Unfocused there is nothing to resolve — planPaneLines
  // already fitted the card — and the whole block renders as it always did.
  const overflow = focused && total > innerRows;
  const viewRows = Math.max(1, overflow ? innerRows - 1 : innerRows);
  const start = focused ? scrollStart(scroll, total, viewRows) : 0;
  const end = focused ? start + viewRows : total;

  const page = Math.max(1, viewRows - 1);
  const scrollBy = (delta: number): void =>
    setScroll((prev) => {
      // `prev` can outrun the content it was clamped against — a poster landing, a resize, a
      // shorter card on the next row — so it is re-clamped before the step rather than after, or
      // the first key press after a shrink is spent walking back into range.
      const from = scrollStart(prev, total, viewRows);
      return scrollStart(from + delta, total, viewRows);
    });

  // Movement keys only: everything else the results view binds stays with the results view, so
  // stepping into the pane never quietly changes what d, y or / do.
  useInput(
    (input, key) => {
      if (key.upArrow || input === "k") scrollBy(-1);
      else if (key.downArrow || input === "j") scrollBy(1);
      else if (key.pageUp) scrollBy(-page);
      else if (key.pageDown) scrollBy(page);
    },
    { isActive: focused },
  );

  // Sliced rather than re-decoded, and identity-preserved in the common case where the whole
  // poster is on screen: Poster is memoised, and a fresh object every render would defeat that
  // for the one thing in this pane expensive enough to reconcile.
  const artWindow = useMemo<PosterCells | null>(() => {
    if (art === null) return null;
    const from = Math.min(start, art.rows);
    const to = Math.min(end, art.rows);
    if (to <= from) return null;
    if (from === 0 && to === art.rows) return art;
    return { cols: art.cols, rows: to - from, lines: art.lines.slice(from, to) };
  }, [art, start, end]);

  const gapVisible = art !== null && start <= artRows && artRows < end;
  const shownText = textRows.slice(Math.max(0, start - head), Math.max(0, end - head));
  const more = `${start > 0 ? ICON.up : ""}${end < total ? ICON.down : ""} more`;

  return (
    <Panel title="info" width={width} height={height} focused={focused}>
      {loading ? (
        <Spinner />
      ) : meta === null ? (
        // One answer for a Games row, an unmatched release and a dead network alike. The pane is
        // a bonus beside the list, and a red error string for a lookup nobody asked for would
        // make a working search look broken.
        <Text dimColor>No metadata</Text>
      ) : (
        <Box flexDirection="column">
          {artWindow !== null && <Poster cells={artWindow} />}
          {gapVisible && <Box height={1} flexShrink={0} />}
          {shownText.map((l) => (
            <Text
              key={l.key}
              wrap="wrap"
              bold={l.tone === "title"}
              color={l.tone === "title" ? COLOR.text : undefined}
              dimColor={l.tone === "dim"}
            >
              {l.text}
            </Text>
          ))}
          {overflow && (
            // The calm theme's answer to a scrollbar: one dim line saying which way there is more
            // of the card, in the same voice as every other hint in the app.
            <Text dimColor>{more}</Text>
          )}
        </Box>
      )}
    </Panel>
  );
}
