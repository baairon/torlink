import { Box, Text, useInput } from "ink";
import { TextField } from "./TextField";
import { Panel } from "./Panel";
import { PromptHints } from "./PromptHints";
import { COLOR, ICON } from "../theme";

interface FolderPromptProps {
  width: number;
  value: string;
  title?: string;
  // One dim context line above the input, e.g. the torrent this download is
  // for. Without it the prompt is a bare path box with no hint of what the
  // user is placing.
  subject?: string;
  // Verb next to ↵; the default fits the settings prompt, the per-download
  // prompt passes "download" so enter reads as the action it performs.
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function FolderPrompt({
  width,
  value,
  title = "default download folder",
  subject,
  submitLabel = "save",
  onSubmit,
  onCancel,
}: FolderPromptProps) {
  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" width={width}>
      <Panel title={title} width={width} focused height={subject ? 3 : 2}>
        {subject ? (
          <Box>
            <Text dimColor wrap="truncate-end">
              {subject}
            </Text>
          </Box>
        ) : null}
        <Box>
          <Text color={COLOR.accent}>{`${ICON.pointer} `}</Text>
          <Box flexGrow={1} minWidth={0}>
            <TextField
              defaultValue={value}
              placeholder="~/Downloads/torlink"
              onSubmit={onSubmit}
            />
          </Box>
        </Box>
      </Panel>
      <Box marginTop={1}>
        <PromptHints submitLabel={submitLabel} />
      </Box>
    </Box>
  );
}
