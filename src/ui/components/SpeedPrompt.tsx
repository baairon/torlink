import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { TextField } from "./TextField";
import { Panel } from "./Panel";
import { PromptHints } from "./PromptHints";
import { formatBytesPerSec, formatRates, parseRates } from "../../util/format";
import { COLOR, ICON } from "../theme";

interface SpeedPromptProps {
  width: number;
  /** Current limits in bytes/sec; 0 on both opens an empty field. */
  down: number;
  up: number;
  onSubmit: (limits: { down: number; up: number }) => void;
  onCancel: () => void;
}

// What the typed text will do, shown above the field as it changes: "5 MB/s"
// and "5" mean the same thing but "5 KB" doesn't, so the reading has to be
// visible before ↵ rather than after it.
function status(text: string): string {
  const parsed = parseRates(text);
  if (!parsed) return "Unreadable — try 5 MB/s, or 5 MB/s, 1 MB/s for both.";
  if (parsed.down <= 0 && parsed.up <= 0) return "No limit either way.";
  const down = parsed.down > 0 ? `↓ ${formatBytesPerSec(parsed.down)}` : "↓ unlimited";
  const up = parsed.up > 0 ? `↑ ${formatBytesPerSec(parsed.up)}` : "↑ unlimited";
  return `${down}   ${up}`;
}

export function SpeedPrompt({ width, down, up, onSubmit, onCancel }: SpeedPromptProps) {
  // Unlimited opens empty rather than as "0": the field's own emptiness is what
  // clears the cap, so the two agree from the first keystroke.
  const initial = formatRates(down, up);
  const [fieldText, setFieldText] = useState(initial);

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" width={width}>
      <Panel title="speed limits" width={width} focused height={3}>
        <Box>
          <Text dimColor wrap="truncate-end">
            {status(fieldText)}
          </Text>
        </Box>
        <Box>
          <Text color={COLOR.accent}>{`${ICON.pointer} `}</Text>
          <Box flexGrow={1} minWidth={0}>
            <TextField
              defaultValue={initial}
              placeholder="5 MB/s, 1 MB/s   (download, upload — empty for no limit)"
              width={Math.max(1, width - 6)}
              onChange={setFieldText}
              onSubmit={(raw) => {
                const parsed = parseRates(raw);
                // An unreadable rate cancels rather than saving a wrong number;
                // the status line has been saying so the whole time.
                if (!parsed) onCancel();
                else onSubmit(parsed);
              }}
            />
          </Box>
        </Box>
      </Panel>
      <Box marginTop={1}>
        <PromptHints submitLabel="save" />
      </Box>
    </Box>
  );
}
