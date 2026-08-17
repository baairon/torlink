import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Panel } from "./Panel";
import { Poster } from "./Poster";
import { Spinner } from "./Spinner";
import { usePoster } from "../hooks/usePoster";
import { useResultMeta } from "../hooks/useResultMeta";
import { scrollStart } from "../move";
import { posterBudget } from "../previewLayout";
import { ellipsizeToWidth, wordWrapLines } from "../textWidth";
import { COLOR, ICON } from "../theme";
import type { PosterCells } from "../../meta/image";
import type { Meta } from "../../meta/types";
import type { TorrentResult } from "../../sources/types";

/** Cast credits worth the rows in a pane this narrow; past the fourth name nobody is reading. */
const CAST_SHOWN = 4;

/**
 * A row's text card: which lines it wants, in the order it wants them, already wrapped.
 *
 * `title` is the one line rendered in full colour; everything under it is dim, so the pane reads
 * as one quiet block the eye can skip rather than a second thing competing with the list.
 *
 * `text` is one block, newlines and all, until the pane flattens it: scrolling counts rows, and a
 * three-line cast credit is three rows to a window that has to cut between them.
 */
interface PaneLine {
  readonly key: string;
  readonly text: string;
  readonly tone: "title" | "dim";
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `1994 · 8.7 · 142 min`, with whatever Cinemeta actually sent. */
function factsLine(meta: Meta): string {
  return [meta.year, meta.rating, meta.runtime]
    .filter((v): v is string => v !== undefined && v !== "")
    .join(` ${ICON.dot} `);
}

/** `S03E07 · Winter Is Coming` — only when the release named an episode we resolved. */
function episodeLine(meta: Meta): string {
  const ep = meta.episode;
  if (ep === undefined) return "";
  const code = `S${pad2(ep.season)}E${pad2(ep.number)}`;
  return ep.title ? `${code} ${ICON.dot} ${ep.title}` : code;
}

/**
 * Two lists of names in a row are indistinguishable without a word saying which is which, and the
 * pane has no room for a label column like the detail view's. The tag rides inside the wrapped
 * text so it is measured with it, not added to a line already sized to fit.
 */
function tagged(tag: string, values: readonly string[]): string {
  return values.length === 0 ? "" : `${tag} ${values.join(", ")}`;
}

/**
 * Which lines of the card fit in `budget` terminal rows, wrapped to `width` display columns.
 *
 * Same contract as the detail panel's planMetaRows, for the same reason: the pane has a fixed
 * height and Ink clips an overflowing box by squeezing rows through Yoga's shrink math, which
 * drops and fuses lines anywhere in the block rather than cutting the one that overflowed. Every
 * line is therefore admitted only once its wrapped height is known.
 *
 * The title is capped rather than dropped — it is the line that says *which* work this is, so a
 * pane with room for one row spends it there. Everything after it shares one cutoff: the first
 * present line that does not fit ends the card, so a short pane degrades as a clean cut at the
 * bottom instead of a hole in the middle. A field Cinemeta simply did not send (no director for
 * most series, no runtime for plenty of titles) is absent, not a fit failure, and never triggers
 * that cutoff.
 *
 * A focused pane passes an infinite budget: it scrolls, so nothing is competing for rows and the
 * whole card is built, with the window — not this function — deciding what is on screen.
 */
function planPaneLines(meta: Meta, width: number, budget: number): PaneLine[] {
  const out: PaneLine[] = [];
  if (budget <= 0) return out;
  let remaining = budget;
  let cutoff = false;

  const titleLines = wordWrapLines(meta.title, width);
  if (titleLines.length > 0) {
    const kept = titleLines.slice(0, remaining);
    if (titleLines.length > remaining) {
      const lastIndex = kept.length - 1;
      const last = kept[lastIndex];
      // A wrapped line fills its width exactly, so a capped title reads as the whole title
      // unless the ellipsis is forced onto it.
      if (last !== undefined) kept[lastIndex] = ellipsizeToWidth(last, width);
      cutoff = true;
    }
    remaining -= kept.length;
    out.push({ key: "title", text: kept.join("\n"), tone: "title" });
  }

  const admit = (key: string, text: string): void => {
    if (cutoff || text === "") return;
    const lines = wordWrapLines(text, width);
    if (lines.length === 0) return;
    if (lines.length > remaining) {
      cutoff = true;
      return;
    }
    remaining -= lines.length;
    out.push({ key, text: lines.join("\n"), tone: "dim" });
  };

  admit("facts", factsLine(meta));
  // Directly under the title, not at the end of the card: on a series row the episode is half of
  // what identifies the release, and the shared cutoff means whatever sits last is the first
  // thing a short pane gives up.
  admit("episode", episodeLine(meta));
  admit("genres", meta.genres.join(", "));
  admit("director", tagged("Dir", meta.director));
  admit("cast", tagged("Cast", meta.cast.slice(0, CAST_SHOWN)));
  return out;
}

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
  const lines = meta === null ? [] : planPaneLines(meta, innerWidth, textBudget);
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
