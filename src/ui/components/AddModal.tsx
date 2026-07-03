import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Panel } from "./Panel";
import { TextField } from "./TextField";
import { Spinner } from "./Spinner";
import { FileSelect } from "./FileSelect";
import { Footer } from "./Footer";
import { useStore } from "../store";
import { wrapStep } from "../move";
import { normalizeDownloadDir } from "../../config/folder";
import { cleanText } from "../../util/format";
import { COLOR, GUTTER, ICON } from "../theme";
import type { Hint } from "../keymap";
import type { DownloadQueue } from "../../download/queue";
import type { FileInfo } from "../../download/engine";
import type { TorrentResult } from "../../sources/types";

// Terse, single-line hints. Rendered through Footer so the row wraps at word
// boundaries (one root <Text>) instead of clipping mid-word on a narrow modal.
const HINTS: Hint[] = [
  { keys: "tab", label: "switch" },
  { keys: "↑↓", label: "move" },
  { keys: "space", label: "toggle" },
  { keys: "↵", label: "start" },
  { keys: "esc", label: "cancel" },
];

interface AddModalProps {
  result: TorrentResult;
  defaultDir: string;
  recents: string[];
  queue: DownloadQueue;
  onCommit: (dir: string, deselected: number[]) => void;
  onCancel: () => void;
  width: number;
}

type Focus = "path" | "files";

export function AddModal({
  result,
  defaultDir,
  recents,
  queue,
  onCommit,
  onCancel,
  width,
}: AddModalProps) {
  const { listRows } = useStore();
  const [focus, setFocus] = useState<Focus>("path");
  const [pathCursor, setPathCursor] = useState(0);
  const [typed, setTyped] = useState(defaultDir);
  const [deselected, setDeselected] = useState<Set<number>>(() => new Set());
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const committed = useRef(false);

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

  useEffect(() => {
    queue.prepare({ id: result.infoHash, magnet: result.magnet }, defaultDir, {
      onFiles: setFiles,
      onError: (msg) => setError(msg),
    });
    return () => {
      if (!committed.current) queue.cancelPrepare(result.infoHash);
    };
  }, [queue, result.infoHash, result.magnet, defaultDir]);

  const resolveDir = (): string =>
    pathCursor === 0 ? normalizeDownloadDir(typed) || defaultDir : recentList[pathCursor - 1]!;

  function confirm(dir: string): void {
    if (files && files.length > 0 && deselected.size >= files.length) {
      setError("Select at least one file.");
      return;
    }
    committed.current = true;
    onCommit(dir, [...deselected].sort((a, b) => a - b));
  }

  useInput((input, key) => {
    if (key.tab) {
      setFocus((f) => (f === "path" ? "files" : "path"));
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (focus === "path" && pathCursor > 0) {
      if (key.upArrow || input === "k") {
        setPathCursor(pathCursor === 1 ? 0 : pathCursor - 1);
        return;
      }
      if (key.downArrow || input === "j") {
        setPathCursor(wrapStep(pathCursor - 1, 1, recentList.length) + 1);
        return;
      }
      if (key.return) {
        confirm(resolveDir());
        return;
      }
      return;
    }
    if (focus === "files" && key.return) {
      confirm(resolveDir());
    }
  });

  const pathPanelHeight = 1 + recentList.length;
  const filesPanelHeight = Math.max(3, listRows - pathPanelHeight - 5);
  const filesInnerWidth = Math.max(10, width - 4);
  const filesSlack = Math.max(1, filesPanelHeight - 1 - (error && files ? 1 : 0));

  function handleToggle(index: number): void {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    setError(null);
  }

  return (
    <Box flexDirection="column" width={width}>
      <Box marginBottom={1}>
        <Text bold color={COLOR.text} wrap="truncate-end">
          {cleanText(result.name)}
        </Text>
      </Box>
      <Panel title="path" width={width} focused={focus === "path"} height={pathPanelHeight}>
        <Box>
          <Box width={GUTTER} flexShrink={0}>
            <Text color={COLOR.accent}>{focus === "path" && pathCursor === 0 ? ICON.pointer : ""}</Text>
          </Box>
          <Box flexGrow={1} minWidth={0}>
            <TextField
              isDisabled={focus !== "path" || pathCursor !== 0}
              defaultValue={defaultDir}
              placeholder="~/Downloads/torlink"
              onChange={setTyped}
              onSubmit={() => confirm(resolveDir())}
              onExitDown={() => setPathCursor(1)}
            />
          </Box>
        </Box>
        {recentList.map((dir, i) => {
          const here = focus === "path" && pathCursor === i + 1;
          return (
            <Box key={dir}>
              <Box width={GUTTER} flexShrink={0}>
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
        <Panel title="files" width={width} focused={focus === "files"} height={filesPanelHeight}>
          {files === null && !error ? (
            <Spinner label="Reading files…" />
          ) : files === null && error ? (
            <Text dimColor>{error}</Text>
          ) : (
            <>
              <FileSelect
                files={files!}
                deselected={deselected}
                onToggle={handleToggle}
                active={focus === "files"}
                focused={focus === "files"}
                width={filesInnerWidth}
                height={filesSlack}
              />
              {error ? <Text dimColor>{error}</Text> : null}
            </>
          )}
        </Panel>
      </Box>

      <Box marginTop={1}>
        <Footer hints={HINTS} />
      </Box>
    </Box>
  );
}
