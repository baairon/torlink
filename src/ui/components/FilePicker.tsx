import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Panel } from "./Panel";
import { windowStart } from "../move";
import { COLOR, GUTTER, ICON } from "../theme";
import { cleanText, formatBytes, truncate } from "../../util/format";
import type { TorrentFileEntry } from "../../download/types";

interface FilePickerProps {
  width: number;
  // The torrent whose files these are; shown as the dim context line.
  subject: string;
  files: TorrentFileEntry[];
  // Visible rows for the file list before it scrolls.
  listRows: number;
  // Files already excluded, so re-opening the picker on an existing download
  // starts from its current selection rather than a clean slate.
  initialExcluded?: number[];
  // Called with the indices to skip. An empty array means "keep everything".
  onSubmit: (excluded: number[]) => void;
  onCancel: () => void;
}

// Pick which files to exclude before a download starts. Every file is kept by
// default; the user toggles off the ones they don't want, and enter downloads
// the rest.
export function FilePicker({
  width,
  subject,
  files,
  listRows,
  initialExcluded,
  onSubmit,
  onCancel,
}: FilePickerProps) {
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set(initialExcluded));
  const [cursor, setCursor] = useState(0);

  const keptCount = files.length - excluded.size;
  const keptBytes = useMemo(
    () => files.reduce((sum, f) => (excluded.has(f.index) ? sum : sum + f.length), 0),
    [files, excluded],
  );

  const listHeight = Math.max(3, Math.min(files.length, listRows));

  const toggle = (index: number): void => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(files.length - 1, c + 1));
      return;
    }
    if (key.pageUp) {
      setCursor((c) => Math.max(0, c - (listHeight - 1)));
      return;
    }
    if (key.pageDown) {
      setCursor((c) => Math.min(files.length - 1, c + (listHeight - 1)));
      return;
    }
    if (input === " " || input === "x") {
      const f = files[cursor];
      if (f) toggle(f.index);
      return;
    }
    if (input === "a") {
      // Invert every file: an all-or-nothing shortcut for long lists.
      setExcluded((prev) =>
        prev.size === files.length ? new Set() : new Set(files.map((f) => f.index)),
      );
      return;
    }
    if (key.return) {
      // Never let the user start a download of nothing.
      if (keptCount === 0) return;
      onSubmit([...excluded]);
    }
  });

  const start = windowStart(cursor, files.length, listHeight);
  const visible = files.slice(start, start + listHeight);
  const nameW = Math.max(8, width - 22);

  const summary =
    keptCount === 0
      ? "Keep at least one file to download."
      : `Keeping ${keptCount}/${files.length} ${ICON.dot} ${formatBytes(keptBytes)}`;

  return (
    <Box flexDirection="column" width={width}>
      <Panel title="exclude files" width={width} focused count={`(${files.length})`} height={listHeight + 1}>
        <Box>
          <Text dimColor wrap="truncate-end">
            {subject}
          </Text>
        </Box>
        {visible.map((f, i) => {
          const index = start + i;
          const here = index === cursor;
          const kept = !excluded.has(f.index);
          return (
            <Box key={f.index}>
              <Box width={GUTTER} flexShrink={0}>
                <Text color={COLOR.accent}>{here ? ICON.pointer : ""}</Text>
              </Box>
              <Box width={2} flexShrink={0}>
                <Text color={kept ? COLOR.good : COLOR.bad}>{kept ? ICON.done : ICON.error}</Text>
              </Box>
              <Box flexGrow={1} minWidth={0} marginLeft={1}>
                <Text
                  color={here ? COLOR.accent : undefined}
                  dimColor={!here || !kept}
                  bold={here}
                  strikethrough={!kept}
                  wrap="truncate-middle"
                >
                  {truncate(cleanText(f.name), nameW)}
                </Text>
              </Box>
              <Box width={9} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                <Text dimColor={!here} bold={here}>
                  {formatBytes(f.length)}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Panel>
      <Box marginTop={1}>
        <Text color={keptCount === 0 ? COLOR.warn : undefined} dimColor={keptCount !== 0}>
          {summary}
        </Text>
      </Box>
      <Box>
        <Text color={COLOR.accent} bold>space</Text>
        <Text color={COLOR.text}> toggle</Text>
        <Text dimColor>{`  ${ICON.dot}  `}</Text>
        <Text color={COLOR.accent} bold>a</Text>
        <Text color={COLOR.text}> all</Text>
        <Text dimColor>{`  ${ICON.dot}  `}</Text>
        <Text color={COLOR.accent} bold>↵</Text>
        <Text color={COLOR.text}> download</Text>
        <Text dimColor>{`  ${ICON.dot}  `}</Text>
        <Text color={COLOR.alt}>esc</Text>
        <Text dimColor> cancel</Text>
      </Box>
    </Box>
  );
}
