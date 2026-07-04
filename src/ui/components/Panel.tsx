import type { ReactNode } from "react";
import { Box, Text } from "ink";
import { COLOR, RULE } from "../theme";

interface PanelProps {
  title: string;
  width: number;
  focused?: boolean;
  count?: string;
  height?: number;
  children: ReactNode;
}

export function Panel({ title, width, focused, count, height, children }: PanelProps) {
  const color = focused ? COLOR.accent : RULE;
  const w = Math.max(10, width);
  const cap = title.charAt(0).toUpperCase() + title.slice(1);
  const label = count ? `${cap} ${count}` : cap;
  const fill = Math.max(0, w - 5 - label.length);

  return (
    <Box flexDirection="column" width={w}>
      <Box>
        <Text color={color}>{"╭─ "}</Text>
        <Text bold color={color}>
          {label}
        </Text>
        <Text color={color}>{` ${"─".repeat(fill)}╮`}</Text>
      </Box>
      <Box
        width={w}
        height={height}
        flexGrow={height ? 0 : 1}
        flexDirection="column"
        borderStyle="round"
        borderTop={false}
        borderColor={color}
        paddingX={1}
        overflow="hidden"
      >
        {children}
      </Box>
    </Box>
  );
}
