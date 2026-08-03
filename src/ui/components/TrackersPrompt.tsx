import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { TextField } from "./TextField";
import { Panel } from "./Panel";
import { PromptHints } from "./PromptHints";
import { formatTrackers, parseTrackers, trackersStatus } from "../../config/trackers";
import { COLOR, ICON } from "../theme";

interface TrackersPromptProps {
  width: number;
  value: string[];
  onSubmit: (trackers: string[]) => void;
  onCancel: () => void;
}

export function TrackersPrompt({ width, value, onSubmit, onCancel }: TrackersPromptProps) {
  const initial = formatTrackers(value);
  const [fieldText, setFieldText] = useState(initial);

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" width={width}>
      <Panel title="extra trackers" width={width} focused height={3}>
        <Box>
          <Text dimColor wrap="truncate-end">
            {trackersStatus(value, fieldText)}
          </Text>
        </Box>
        <Box>
          <Text color={COLOR.accent}>{`${ICON.pointer} `}</Text>
          <Box flexGrow={1} minWidth={0}>
            <TextField
              defaultValue={initial}
              placeholder="udp://tracker.example:1337/announce, https://..."
              width={Math.max(1, width - 6)}
              onChange={setFieldText}
              onSubmit={(raw) => onSubmit(parseTrackers(raw))}
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
