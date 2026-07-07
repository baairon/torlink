import { Box, Text } from "ink";
import { COLOR, ICON } from "../theme";

// The one-line action row under a modal prompt: the submit verb carries the
// visual weight, esc stays quiet.
export function PromptHints({ submitLabel }: { submitLabel: string }) {
  return (
    <Box>
      <Text color={COLOR.accent} bold>
        ↵
      </Text>
      <Text color={COLOR.text}>{` ${submitLabel}`}</Text>
      <Text dimColor>{`  ${ICON.dot}  `}</Text>
      <Text color={COLOR.alt}>esc</Text>
      <Text dimColor> cancel</Text>
    </Box>
  );
}
