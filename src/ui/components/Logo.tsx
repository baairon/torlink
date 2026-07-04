import { Box, Text } from "ink";
import { LOGO_LINES, SPROUT_CELLS } from "../logo";
import { COLOR, lerpHex } from "../theme";

const HIGHLIGHT = "#ffffff";
const TOP = COLOR.bright;
const BASE = "#7c5cd6";
const SHADE = "#4c3a8a";
const SPROUT_COLOR = "#5ae87a";

function getSheen(t: number): string {
  if (t < 0.15) return lerpHex(HIGHLIGHT, TOP, t / 0.15);
  if (t < 0.4) return lerpHex(TOP, COLOR.accent, (t - 0.15) / 0.25);
  if (t < 0.7) return lerpHex(COLOR.accent, BASE, (t - 0.4) / 0.3);
  return lerpHex(BASE, SHADE, (t - 0.7) / 0.3);
}

export function Logo() {
  const rows = LOGO_LINES.length;

  return (
    <Box flexDirection="column">
      {LOGO_LINES.map((line, row) => {
        const textRow = Math.max(0, row - 1);
        const textRows = Math.max(1, rows - 1);
        const tY = textRow / (textRows - 1 || 1);
        const chars = [...line];
        const last = Math.max(1, chars.length - 1);

        return (
          <Box key={row}>
            {chars.map((ch, i) => {
              if (ch === " ") return <Text key={i}> </Text>;

              if (SPROUT_CELLS.has(`${row},${i}`)) {
                return (
                  <Text key={i} bold color={SPROUT_COLOR}>
                    {ch}
                  </Text>
                );
              }

              const tX = i / last;
              const factor = (tX + tY) / 2;

              return (
                <Text key={i} bold color={getSheen(factor)}>
                  {ch}
                </Text>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}
