import { memo } from "react";
import { Box, Text } from "ink";
import type { PosterCells } from "../../meta/image";

// U+2580 UPPER HALF BLOCK. The foreground colour paints the top half of the cell and the
// background colour the bottom half, which is how two pixel rows fit in one terminal row.
// textWidth.ts classifies the whole Block Elements range as one column, so a line of these
// measures exactly `cols` — the property the pane's frame and the list beside it depend on.
const HALF_BLOCK = "▀";

/**
 * A decoded poster as rows of coloured half-blocks.
 *
 * Per-run `<Text>` rather than per-cell, the same idiom as Logo.tsx but with the runs already
 * merged upstream. Ink's `backgroundColor` goes through chalk, which downgrades a hex colour to
 * the 256- or 16-colour palette the terminal actually advertises, so there is no quantizer here
 * and no capability sniffing: the art is emitted in truecolour and chalk decides what survives.
 *
 * Memoised because the pane re-renders on every search tick and every cursor move, while the art
 * only changes when the selected row does — and a 24x18 poster is ~430 elements to reconcile.
 */
export const Poster = memo(function Poster({ cells }: { cells: PosterCells }) {
  return (
    <Box flexDirection="column" width={cells.cols} flexShrink={0}>
      {cells.lines.map((runs, row) => (
        <Box key={row}>
          {runs.map((run, i) => (
            <Text key={i} color={run.fg} backgroundColor={run.bg}>
              {HALF_BLOCK.repeat(run.n)}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
});
