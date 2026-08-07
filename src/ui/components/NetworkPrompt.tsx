import { Box, Text, useInput } from "ink";
import { TextField } from "./TextField";
import { Panel } from "./Panel";
import { PromptHints } from "./PromptHints";
import { COLOR, ICON } from "../theme";

interface NetworkPromptProps {
  width: number;
  value: string | null;
  onSubmit: (value: string | null) => void;
  onCancel: () => void;
}

export function NetworkPrompt({
  width,
  value,
  onSubmit,
  onCancel,
}: NetworkPromptProps) {
  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" width={width}>
      <Panel title="network interface binding" width={width} focused height={3}>
        <Box>
          <Text dimColor wrap="truncate-end">
            Bind traffic to an IP (e.g. 10.8.0.2). Leave empty for default.
          </Text>
        </Box>
        <Box>
          <Text color={COLOR.accent}>{`${ICON.pointer} `}</Text>
          <Box flexGrow={1} minWidth={0}>
            <TextField
              defaultValue={value || ""}
              placeholder="0.0.0.0"
              width={Math.max(1, width - 6)}
              onSubmit={(val) => {
                const trimmed = val.trim();
                onSubmit(trimmed ? trimmed : null);
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
