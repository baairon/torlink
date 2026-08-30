import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Panel } from "./Panel";
import { Poster } from "./Poster";
import { Spinner } from "./Spinner";
import { usePoster } from "../hooks/usePoster";
import { useResultMeta } from "../hooks/useResultMeta";
import { scrollStart } from "../move";
import { planPaneLines } from "../paneCard";
import { COLUMN_GAP, MAX_TEXT_COLS, posterBudget, splitTextCols } from "../previewLayout";
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
 * full-size poster, rows that scroll instead of rows that were cut to fit, and — where the columns
 * are there for it — the poster and the card side by side instead of stacked.
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
  // expected — including which of the two layouts below it gets. A poster still in flight, refused
  // by the host sniff or rejected by the decoder therefore leaves the text with the whole pane to
  // itself: no reserved hole, no gap, and no column held open for a picture that may never come.
  // The cost is one settle when art does land, and only then.
  const artRows = art === null ? 0 : art.rows;
  const artCols = art === null ? 0 : art.cols;

  // A poster fitCells had to cap by rows comes back narrower than the pane that asked for it, and
  // stacking leaves those freed columns as dead gutter beside the art while the card below them
  // has one row to say anything in. Focused, the pane spends them on the card instead: the art
  // takes the left column and the text flows down the right. splitTextCols answers null when the
  // card would land under a readable measure, and null is the stacked layout the pane has always
  // drawn — unfocused it is the only layout, because a 34-column tier split two ways is neither.
  const cardCols = focused ? splitTextCols(innerWidth, artCols) : null;
  const split = cardCols !== null;
  // Clamped in both layouts, because the pane is no longer only ever a card: it is granted width
  // for a poster *and* a measure, so a poster that arrives narrower than the box it was budgeted
  // into — a squarer rendition, or one refused entirely — would otherwise leave the card wrapping
  // prose across the whole grant. MAX_TEXT_COLS is the measure either way; any surplus stays blank.
  const textWidth = Math.min(cardCols ?? innerWidth, MAX_TEXT_COLS);

  // Rows the art claims off the top of the card before the text starts. Stacked that is the whole
  // picture plus the blank spacer under it; side by side it is none of them — row i is art row i
  // *beside* card row i, so both columns share one offset and one window slices them together.
  const head = split || art === null ? 0 : artRows + 1;
  // Unfocused the card is cut to what is left; focused it is built whole and the window below
  // decides what shows, which is the entire point of being able to focus it.
  const textBudget = focused ? Number.POSITIVE_INFINITY : Math.max(0, innerRows - head);
  // Memoised because the pane re-renders on every search tick and every cursor move, while the
  // word wrapper is linear in the plot — the one field long enough for that to be worth a cache.
  const lines = useMemo(
    () => (meta === null ? [] : planPaneLines(meta, textWidth, textBudget)),
    [meta, textWidth, textBudget],
  );
  // One entry per terminal row, so the window can cut inside a wrapped credit.
  const textRows = lines.flatMap((l) =>
    l.text.split("\n").map((text, i) => ({ key: `${l.key}:${i}`, text, tone: l.tone })),
  );

  // Side by side the two columns are the same rows, not consecutive ones, so the block is as tall
  // as the taller of them rather than as tall as both.
  const total = split ? Math.max(artRows, textRows.length) : head + textRows.length;
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

  // The spacer row only exists in the stacked layout, and only while the window is over it.
  const gapVisible = !split && art !== null && start <= artRows && artRows < end;
  const shownText = textRows.slice(Math.max(0, start - head), Math.max(0, end - head));
  const more = `${start > 0 ? ICON.up : ""}${end < total ? ICON.down : ""} more`;

  const card = shownText.map((l) => (
    <Text
      key={l.key}
      wrap="wrap"
      bold={l.tone === "title"}
      color={l.tone === "title" ? COLOR.text : undefined}
      dimColor={l.tone === "dim"}
    >
      {l.text}
    </Text>
  ));

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
          {split ? (
            // Both columns are pinned, and together they never exceed innerWidth — usually they
            // fill it, and where the card hit MAX_TEXT_COLS the remainder simply stays blank. What
            // matters is that Yoga is never asked to shrink either one: a shrunk column would
            // rewrap text planPaneLines already wrapped, which is how a card ends up a row taller
            // than the window that was sized for it. The art's column keeps its width even once
            // the window has scrolled past the last row of the picture, so the card never slides
            // left mid-scroll and never rewraps under the reader.
            <Box>
              <Box flexDirection="column" width={artCols} flexShrink={0}>
                {artWindow !== null && <Poster cells={artWindow} />}
              </Box>
              <Box
                flexDirection="column"
                width={textWidth}
                flexShrink={0}
                marginLeft={COLUMN_GAP}
              >
                {card}
              </Box>
            </Box>
          ) : (
            <>
              {artWindow !== null && <Poster cells={artWindow} />}
              {gapVisible && <Box height={1} flexShrink={0} />}
              {card}
            </>
          )}
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
