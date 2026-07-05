import { Box, Text, useInput } from "ink";
import { TextField } from "./TextField";
import { Panel } from "./Panel";
import { COLOR, ICON } from "../theme";

interface FolderPromptProps {
  width: number;
  value: string;
  title?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function FolderPrompt({
  width,
  value,
  title = "download folder",
  onSubmit,
  onCancel,
}: FolderPromptProps) {
  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" width={width}>
      <Panel title={title} width={width} focused height={2}>
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
        <Text color={COLOR.alt}>↵</Text>
        <Text dimColor> save</Text>
        <Text dimColor>{`     ${ICON.dot}     `}</Text>
        <Text color={COLOR.alt}>esc</Text>
        <Text dimColor> cancel</Text>
      </Box>
    </Box>
  );
}
