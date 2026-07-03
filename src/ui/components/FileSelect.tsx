import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { FileInfo } from "../../download/engine";
import { wrapStep, windowStart } from "../move";
import { COLOR, GUTTER, ICON } from "../theme";
import { formatBytes } from "../../util/format";

interface FileSelectProps {
  files: FileInfo[];
  deselected: Set<number>;
  onToggle: (index: number) => void;
  active: boolean;
  focused: boolean;
  width: number;
  height: number;
}

const CHECKBOX_W = 3;
const SIZE_W = 10;

// Shared, scrollable checkbox list for a torrent's files. Space toggles the
// cursor row; up/down move it. Tab/enter/esc are deliberately left unhandled
// so a hosting modal (AddModal, DownloadFilesModal) owns those keys.
export function FileSelect({
  files,
  deselected,
  onToggle,
  active,
  focused,
  width,
  height,
}: FileSelectProps) {
  const [cursor, setCursor] = useState(0);
  const clamped = Math.min(cursor, Math.max(0, files.length - 1));

  useInput(
    (input, key) => {
      if (key.upArrow || input === "k") setCursor(wrapStep(clamped, -1, files.length));
      else if (key.downArrow || input === "j") setCursor(wrapStep(clamped, 1, files.length));
      else if (input === " ") onToggle(clamped);
    },
    { isActive: active },
  );

  const start = windowStart(clamped, files.length, height);
  const visible = files.slice(start, start + height);

  return (
    <Box flexDirection="column" width={width}>
      {visible.map((file, i) => {
        const index = start + i;
        const here = index === clamped && focused;
        const off = deselected.has(index);
        return (
          <Box key={file.path}>
            <Box width={GUTTER} flexShrink={0}>
              <Text color={COLOR.accent}>{focused && here ? ICON.pointer : ""}</Text>
            </Box>
            <Box width={CHECKBOX_W} flexShrink={0}>
              <Text color={here ? COLOR.accent : undefined} bold={here} dimColor={!here}>
                {off ? "[ ]" : "[x]"}
              </Text>
            </Box>
            <Box flexGrow={1} minWidth={0} marginLeft={1}>
              <Text
                wrap="truncate-end"
                color={here ? COLOR.accent : undefined}
                bold={here}
                dimColor={off || !here}
              >
                {file.name}
              </Text>
            </Box>
            <Box width={SIZE_W} flexShrink={0} marginLeft={1} justifyContent="flex-end">
              <Text dimColor>{formatBytes(file.length)}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
