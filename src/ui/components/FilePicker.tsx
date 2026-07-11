import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Panel } from "./Panel";
import { Spinner } from "./Spinner";
import { wrapStep, windowStart } from "../move";
import { COLOR, ICON } from "../theme";
import { formatBytes, cleanText, truncate } from "../../util/format";
import type { TorrentFileInfo } from "../../download/types";

interface FilePickerProps {
  status: "fetching" | "ready" | "error";
  files: TorrentFileInfo[];
  torrentName: string;
  error?: string;
  width: number;
  height: number;
  initialSelection?: number[];
  onConfirm: (selectedIndices: number[]) => void;
  onCancel: () => void;
}

const MARK = 2;
const CHK_W = 4;
const SIZE_W = 10;

function computeSelection(files: TorrentFileInfo[], initialSelection?: number[]): Set<number> {
  if (initialSelection) return new Set(initialSelection.filter((i) => i >= 0 && i < files.length));
  return new Set(files.map((_, i) => i));
}

interface DirGroup {
  dir: string;
  entries: { index: number; info: TorrentFileInfo }[];
}

// Strip the first path segment (usually the torrent root directory) so that
// group headers show just the subfolder name. e.g. "Torrent/Subdir" → "Subdir".
function stripRoot(dir: string): string {
  if (!dir) return "";
  const slash = dir.indexOf("/");
  if (slash === -1) return "";
  return dir.slice(slash + 1);
}

function groupFilesByDir(files: TorrentFileInfo[]): DirGroup[] {
  const map = new Map<string, { index: number; info: TorrentFileInfo }[]>();
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    const full = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
    const d = stripRoot(full);
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push({ index: i, info: f });
  }
  const groups: DirGroup[] = [];
  for (const [dir, entries] of map) {
    groups.push({ dir, entries });
  }
  groups.sort((a, b) => a.dir.localeCompare(b.dir));
  return groups;
}

type Row =
  | { kind: "dir"; path: string }
  | { kind: "file"; index: number };

export function FilePicker({
  status,
  files,
  torrentName,
  error,
  width,
  height,
  initialSelection,
  onConfirm,
  onCancel,
}: FilePickerProps) {
  const [selected, setSelected] = useState<Set<number>>(() => computeSelection(files, initialSelection));
  const [cursor, setCursor] = useState(0);

  const groups = useMemo(() => groupFilesByDir(files), [files]);

  const rows: Row[] = useMemo(() => {
    const r: Row[] = [];
    for (const g of groups) {
      r.push({ kind: "dir", path: g.dir });
      for (const e of g.entries) {
        r.push({ kind: "file", index: e.index });
      }
    }
    return r;
  }, [groups]);

  const rowCount = rows.length;

  // Ensure cursor starts on a file row, not a dir header.
  useEffect(() => {
    if (rows.length > 0 && rows[0]?.kind === "dir") {
      let n = 0;
      while (n < rows.length && rows[n]!.kind === "dir") n++;
      if (n < rows.length) setCursor(n);
    }
  }, [rows]);

  const toggle = (i: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  // Always active: esc to cancel in any state.
  useInput(
    (_input, key) => {
      if (key.escape) onCancel();
    },
    { isActive: true },
  );

  // Navigation and confirm: only when files are available.
  useInput(
    (input, key) => {
      if (input === "d") {
        if (selected.size === 0) return;
        onConfirm([...selected]);
        return;
      }
      if (key.upArrow || input === "k") {
        setCursor((c) => {
          let n = wrapStep(c, -1, rowCount);
          while (n >= 0 && n < rowCount && rows[n]!.kind === "dir") n = wrapStep(n, -1, rowCount);
          return n;
        });
        return;
      }
      if (key.downArrow || input === "j") {
        setCursor((c) => {
          let n = wrapStep(c, 1, rowCount);
          while (n >= 0 && n < rowCount && rows[n]!.kind === "dir") n = wrapStep(n, 1, rowCount);
          return n;
        });
        return;
      }
      if (input === " ") {
        const row = rows[cursor];
        if (row && row.kind === "file") toggle(row.index);
        return;
      }
    },
    { isActive: status === "ready" && files.length > 0 },
  );

  if (status === "fetching") {
    return (
      <Panel title="files" width={width} focused height={5}>
        <Spinner label={`Fetching file list for ${truncate(cleanText(torrentName), 40)}…`} />
      </Panel>
    );
  }

  if (status === "error") {
    return (
      <Panel title="files" width={width} focused height={5}>
        <Text color={COLOR.bad}>{error ?? "Could not fetch file list."}</Text>
        <Box marginTop={1}>
          <Text>
            <Text color={COLOR.alt}>esc</Text>
            <Text dimColor> back</Text>
          </Text>
        </Box>
      </Panel>
    );
  }

  if (files.length === 0) {
    return (
      <Panel title="files" width={width} focused height={5}>
        <Text dimColor>No files found in this torrent.</Text>
        <Box marginTop={1}>
          <Text>
            <Text color={COLOR.alt}>esc</Text>
            <Text dimColor> back</Text>
          </Text>
        </Box>
      </Panel>
    );
  }

  const totalBytes = files.reduce((s, f) => s + f.length, 0);
  const selectedBytes = files.reduce((s, f, i) => (selected.has(i) ? s + f.length : s), 0);
  const chrome = 6;
  const listH = Math.max(3, Math.min(rowCount, height - chrome));
  const fileCount = files.length;
  const inner = Math.max(10, width - 4);
  const nameW = Math.max(10, inner - MARK - CHK_W - SIZE_W - 2);

  const start = windowStart(cursor, rowCount, listH);
  const visible = rows.slice(start, start + listH);
  const currentCursorRow = rows[cursor];
  const currentFileIndex = currentCursorRow && currentCursorRow.kind === "file" ? currentCursorRow.index : 0;

  return (
    <Panel title={`files  ${ICON.dot}  ${truncate(cleanText(torrentName), 50)}`} width={width} focused height={height}>
      <Box>
        <Box width={MARK} flexShrink={0}>
          <Text bold dimColor />
        </Box>
        <Box width={CHK_W} flexShrink={0}>
          <Text bold dimColor />
        </Box>
        <Box flexGrow={1} minWidth={0} marginLeft={1}>
          <Text bold dimColor>Name</Text>
        </Box>
        <Box width={SIZE_W} flexShrink={0} marginLeft={1} justifyContent="flex-end">
          <Text bold dimColor>Size</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {visible.map((row, offset) => {
          if (row.kind === "dir") {
            const label = row.path || ".";
            return (
              <Box key={`dir:${row.path}`} marginLeft={MARK + CHK_W}>
                <Text dimColor bold wrap="truncate-end">
                  {label}/
                </Text>
              </Box>
            );
          }
          const fi = files[row.index]!;
          const here = row.index === currentFileIndex;
          const chk = selected.has(row.index) ? ICON.done : " ";
          return (
            <Box key={`${fi.path}:${fi.name}`}>
              <Box width={MARK} flexShrink={0}>
                <Text color={COLOR.accent}>{here ? ICON.pointer : ""}</Text>
              </Box>
              <Box width={CHK_W} flexShrink={0}>
                <Text color={selected.has(row.index) ? COLOR.good : COLOR.alt} bold={selected.has(row.index)}>
                  [{chk}]
                </Text>
              </Box>
              <Box flexGrow={1} minWidth={0} marginLeft={1}>
                <Text
                  wrap="truncate-end"
                  color={here ? COLOR.accent : undefined}
                  bold={here}
                  dimColor={!here}
                >
                  {fi.path.includes("/") ? fi.path.slice(fi.path.lastIndexOf("/") + 1) : fi.name}
                </Text>
              </Box>
              <Box width={SIZE_W} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                <Text dimColor>{fi.length > 0 ? formatBytes(fi.length) : "-"}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {`${selected.size}/${fileCount} files  ${ICON.dot}  ${formatBytes(selectedBytes)} / ${formatBytes(totalBytes)}`}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text>
          <Text color={COLOR.accent} bold>space</Text>
          <Text dimColor> toggle  </Text>
          <Text color={COLOR.accent} bold>d</Text>
          <Text dimColor> download selected  </Text>
          <Text color={COLOR.alt}>esc</Text>
          <Text dimColor> back</Text>
        </Text>
      </Box>
    </Panel>
  );
}
