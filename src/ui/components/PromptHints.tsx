import { Box, Text } from "ink";
import { COLOR, ICON } from "../theme";
import { Clickable, useMouse } from "../mouse";

// The one-line action row under a modal prompt: the submit verb carries the
// visual weight, esc stays quiet.
export function PromptHints({ submitLabel }: { submitLabel: string }) {
  const { press } = useMouse();
  return (
    <Box>
      <Clickable onClick={() => press("\r")}>
        <Text color={COLOR.accent} bold>
          ↵
        </Text>
        <Text color={COLOR.text}>{` ${submitLabel}`}</Text>
      </Clickable>
      <Text dimColor>{`  ${ICON.dot}  `}</Text>
      <Clickable onClick={() => press("\x1b")}>
        <Text color={COLOR.alt}>esc</Text>
        <Text dimColor> cancel</Text>
      </Clickable>
    </Box>
  );
}
