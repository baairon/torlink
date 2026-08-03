import { Box, Text } from "ink";
import { COLOR } from "../theme";
import type { Hint } from "../keymap";

export function Footer({ hints }: { hints: Hint[] }) {
  return (
    <Box>
      {/* App budgets exactly one row for the footer, so the hints truncate
          rather than wrapping and pushing the layout past the terminal. */}
      <Text wrap="truncate-end">
        {hints.map((h, i) => (
          <Text key={h.keys + h.label}>
            {i > 0 ? <Text dimColor>{"   "}</Text> : null}
            <Text color={COLOR.alt}>{h.keys}</Text>
            <Text dimColor>{` ${h.label}`}</Text>
          </Text>
        ))}
      </Text>
    </Box>
  );
}
