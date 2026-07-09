import { Box, Text } from "ink";
import { COL_GAP, FRAME, KEY_W, pickLayout } from "../helpLayout";
import { HELP_GROUPS } from "../keymap";
import { useStore } from "../store";
import { COLOR, ICON, RULE, lerpHex } from "../theme";

const CARD_BORDER = lerpHex(COLOR.accent, RULE, 0.55);

const FOOT_FULL = "Your downloaded files always stay on disk.";

export function HelpOverlay() {
  const { cols, rows } = useStore();
  const m = pickLayout(cols);
  const width = Math.min(m.width, cols - 2);
  // Condense when the full card (gridH + 9 rows, under 3 rows of app chrome)
  // exceeds the terminal, or the card is too narrow for the two-line footer.
  const short = rows < m.gridH + 12 || width - FRAME < FOOT_FULL.length;

  return (
    <Box
      flexDirection="column"
      alignSelf="flex-start"
      width={width}
      borderStyle="round"
      borderColor={CARD_BORDER}
      paddingX={1}
      paddingY={short ? 0 : 1}
    >
      <Text bold color={COLOR.accent}>
        Keyboard
      </Text>
      <Box marginTop={1} flexDirection="row">
        {m.layout.map((col, ci) => (
          <Box
            key={col.join("-")}
            flexDirection="column"
            width={Math.min(m.colWidths[ci]!, width - FRAME)}
            marginRight={ci < m.layout.length - 1 ? COL_GAP : 0}
          >
            {col.map((gi, pos) => {
              const group = HELP_GROUPS[gi]!;
              return (
                <Box
                  key={group.title}
                  flexDirection="column"
                  marginTop={pos > 0 ? 1 : 0}
                >
                  <Text bold>{group.title}</Text>
                  {group.hints.map((h) => (
                    <Box key={h.keys + h.label}>
                      <Box width={KEY_W[gi]} flexShrink={0}>
                        <Text color={COLOR.alt}>{h.keys}</Text>
                      </Box>
                      <Text dimColor wrap="truncate-end">
                        {h.label}
                      </Text>
                    </Box>
                  ))}
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
      {short ? (
        <Text dimColor wrap="truncate-end">
          {`? or esc closes ${ICON.dot} files stay on disk`}
        </Text>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>{FOOT_FULL}</Text>
          <Text dimColor>Press ? or esc to close</Text>
        </Box>
      )}
    </Box>
  );
}
