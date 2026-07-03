import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { TextField } from "./TextField";
import { Panel } from "./Panel";
import { Footer } from "./Footer";
import { normalizeDownloadDir } from "../../config/folder";
import { wrapStep } from "../move";
import { COLOR, ICON } from "../theme";
import type { Hint } from "../keymap";

const HINTS: Hint[] = [
  { keys: "↑↓", label: "folder" },
  { keys: "↵", label: "start" },
  { keys: "esc", label: "cancel" },
];

interface DownloadFolderPromptProps {
  width: number;
  defaultDir: string;
  recents: string[];
  onSubmit: (dir: string) => void;
  onCancel: () => void;
}

export function DownloadFolderPrompt({
  width,
  defaultDir,
  recents,
  onSubmit,
  onCancel,
}: DownloadFolderPromptProps) {
  const [cursor, setCursor] = useState(0);
  const [typed, setTyped] = useState(defaultDir);

  // [default, ...recents] deduped, default always first.
  const recentList = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const dir of [defaultDir, ...recents]) {
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      list.push(dir);
    }
    return list;
  }, [defaultDir, recents]);

  const resolve = (): string =>
    cursor === 0 ? normalizeDownloadDir(typed) || defaultDir : recentList[cursor - 1]!;

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (cursor > 0) {
      if (key.upArrow || input === "k") {
        setCursor(cursor === 1 ? 0 : cursor - 1);
        return;
      }
      if (key.downArrow || input === "j") {
        setCursor(wrapStep(cursor - 1, 1, recentList.length) + 1);
        return;
      }
      if (key.return) {
        onSubmit(recentList[cursor - 1]!);
        return;
      }
    }
  });

  // One row of slack so the fixed-height panel never *exactly* fills its content
  // (input + recents), which desyncs Ink's incremental renderer and swallows a
  // row — the same issue #21 guard used elsewhere (see src/ui/move.ts).
  const panelHeight = 1 + recentList.length + 1;

  return (
    <Box flexDirection="column" width={width}>
      <Panel title="download folder" width={width} focused height={panelHeight}>
        <Box>
          <Box width={2} flexShrink={0}>
            <Text color={COLOR.accent}>{cursor === 0 ? ICON.pointer : ""}</Text>
          </Box>
          <Box flexGrow={1} minWidth={0}>
            <TextField
              isDisabled={cursor !== 0}
              defaultValue={defaultDir}
              placeholder="~/Downloads/torlink"
              onChange={setTyped}
              onSubmit={() => onSubmit(resolve())}
              onExitDown={() => setCursor(1)}
            />
          </Box>
        </Box>
        {recentList.map((dir, i) => {
          const here = cursor === i + 1;
          return (
            <Box key={dir}>
              <Box width={2} flexShrink={0}>
                <Text color={COLOR.accent}>{here ? ICON.pointer : ""}</Text>
              </Box>
              <Box flexGrow={1} minWidth={0}>
                <Text wrap="truncate-end" color={here ? COLOR.accent : undefined} bold={here} dimColor={!here}>
                  {dir}
                </Text>
              </Box>
              {i === 0 ? (
                <Box flexShrink={0} marginLeft={1}>
                  <Text dimColor>default</Text>
                </Box>
              ) : null}
            </Box>
          );
        })}
      </Panel>
      <Box marginTop={1}>
        <Footer hints={HINTS} />
      </Box>
    </Box>
  );
}
