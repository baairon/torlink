import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Panel } from "./Panel";
import { PromptHints } from "./PromptHints";
import { applyTheme, COLOR, ICON, THEMES, type ThemeId } from "../theme";

interface ThemePromptProps {
  width: number;
  value: ThemeId;
  onSubmit: (id: ThemeId) => void;
  onCancel: () => void;
}

const SWATCH = "██";

export function ThemePrompt({ width, value, onSubmit, onCancel }: ThemePromptProps) {
  const startIndex = Math.max(
    0,
    THEMES.findIndex((t) => t.id === value),
  );
  const [index, setIndex] = useState(startIndex);
  const theme = THEMES[index]!;

  // Live preview: the palette is repainted as the cursor moves, so the whole
  // interface behind the prompt shows what the theme actually looks like
  // rather than asking anyone to judge it from four swatches.
  useEffect(() => {
    applyTheme(theme.id);
  }, [theme.id]);

  useInput((input, key) => {
    if (key.escape) {
      // Put back what was there before: a preview that survived cancelling
      // would be a change nobody asked for.
      applyTheme(value);
      onCancel();
      return;
    }
    if (key.return) {
      onSubmit(theme.id);
      return;
    }
    if (key.rightArrow || key.downArrow || input === "l" || input === "j") {
      setIndex((i) => (i + 1) % THEMES.length);
    } else if (key.leftArrow || key.upArrow || input === "h" || input === "k") {
      setIndex((i) => (i - 1 + THEMES.length) % THEMES.length);
    }
  });

  return (
    <Box flexDirection="column" width={width}>
      <Panel title="theme" width={width} focused height={3}>
        <Box>
          <Text dimColor wrap="truncate-end">
            {`${index + 1} of ${THEMES.length} · everything behind this box is already wearing it`}
          </Text>
        </Box>
        <Box>
          <Text color={COLOR.accent}>{`${ICON.pointer} `}</Text>
          <Text color={COLOR.text}>{theme.name}</Text>
          <Text>{"  "}</Text>
          <Text color={theme.deep}>{SWATCH}</Text>
          <Text color={theme.accent}>{SWATCH}</Text>
          <Text color={theme.bright}>{SWATCH}</Text>
        </Box>
      </Panel>
      <Box marginTop={1}>
        <PromptHints submitLabel="keep" />
      </Box>
    </Box>
  );
}
