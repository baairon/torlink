import { Box, Text } from "ink";
import { TextField } from "./TextField";
import { Panel } from "./Panel";
import { COLOR, ICON } from "../theme";

interface SearchBarProps {
  width: number;
  value: string;
  placeholder?: string;
  editing: boolean;
  onSubmit: (value: string) => void;
  onChange?: (value: string) => void;
  onExitDown?: () => void;
  onExitLeft?: () => void;
}

export function SearchBar({
  width,
  value,
  placeholder = "Search torrents…",
  editing,
  onSubmit,
  onChange,
  onExitDown,
  onExitLeft,
}: SearchBarProps) {
  return (
    <Panel title="search" width={width} focused={editing} height={2}>
      <Box>
        <Text color={COLOR.accent}>{`${ICON.pointer} `}</Text>
        <Box flexGrow={1} minWidth={0}>
          {editing ? (
            <TextField
              defaultValue={value}
              placeholder={placeholder}
              onSubmit={onSubmit}
              onChange={onChange}
              onExitDown={onExitDown}
              onExitLeft={onExitLeft}
            />
          ) : value ? (
            <Text wrap="truncate-end">{value}</Text>
          ) : (
            <Text dimColor>{placeholder}</Text>
          )}
        </Box>
      </Box>
    </Panel>
  );
}
