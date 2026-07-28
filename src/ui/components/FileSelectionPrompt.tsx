import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Panel } from "./Panel";
import { PromptHints } from "./PromptHints";
import { Spinner } from "./Spinner";
import { COLOR, ICON } from "../theme";
import { formatBytes, truncate } from "../../util/format";

interface FileSelectionPromptProps {
  width: number;
  magnet: string;
  title?: string;
  trackers?: string[];
  fetchMetadata: (magnet: string, trackers: string[], onResult: (res: any, files: any[]) => void, onError: (err: Error) => void) => () => void;
  onSubmit: (selections: boolean[], meta: any) => void;
  onCancel: () => void;
}

export function FileSelectionPrompt({
  width,
  magnet,
  title = "select files",
  trackers = [],
  fetchMetadata,
  onSubmit,
  onCancel,
}: FileSelectionPromptProps) {
  const [meta, setMeta] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selections, setSelections] = useState<boolean[]>([]);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const magnetTrackers: string[] = [];
    try {
      new URL(magnet).searchParams.getAll("tr").forEach((t) => magnetTrackers.push(t));
    } catch {}
    const allTrackers = Array.from(new Set([...magnetTrackers, ...trackers]));
    const cancel = fetchMetadata(
      magnet,
      allTrackers,
      (res, files) => {
        const result = { ...res, files };
        if (files.length <= 1) {
          // Auto-submit if there's no real choice
          onSubmit(files.map(() => true), result);
        } else {
          setMeta(result);
          setSelections(files.map(() => true));
        }
      },
      (err) => {
        setError(err.message);
      }
    );
    return () => cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [magnet, onSubmit, trackers.join(",")]);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (!meta) return;

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(meta.files.length - 1, c + 1));
    } else if (_input === " ") {
      setSelections((s) => {
        const next = [...s];
        next[cursor] = !next[cursor];
        return next;
      });
    } else if (key.return) {
      onSubmit(selections, meta);
    }
  });

  const listHeight = 6;
  let viewFiles = meta?.files || [];
  let viewSelections = selections;

  let offset = 0;
  if (viewFiles.length > listHeight) {
    offset = Math.max(0, cursor - Math.floor(listHeight / 2));
    if (offset + listHeight > viewFiles.length) {
      offset = viewFiles.length - listHeight;
    }
    viewFiles = viewFiles.slice(offset, offset + listHeight);
    viewSelections = viewSelections.slice(offset, offset + listHeight);
  }

  const selectedCount = selections.filter((s) => s).length;
  const totalCount = selections.length;

  return (
    <Box flexDirection="column" width={width}>
      <Panel title={title} width={width} focused height={meta ? listHeight + 4 : 3}>
        {!meta && !error ? (
          <Box paddingX={1}>
            <Spinner label="Fetching metadata from swarm..." />
          </Box>
        ) : error ? (
          <Box paddingX={1}>
            <Text color={COLOR.bad}>{`Error: ${truncate(error, width - 12)}`}</Text>
          </Box>
        ) : (
          <Box flexDirection="column" width="100%">
            <Box marginBottom={1} paddingX={1}>
              <Text dimColor>{truncate(meta!.name, width - 18)}</Text>
              <Box flexGrow={1} />
              <Text color={COLOR.accent}>{`${selectedCount}/${totalCount} files`}</Text>
            </Box>
            {viewFiles.map((f: { path: string; length: number }, i: number) => {
              const absIndex = offset + i;
              const isFocused = absIndex === cursor;
              const isSelected = viewSelections[i];
              return (
                <Box key={absIndex} paddingX={1}>
                  <Text color={isFocused ? COLOR.accent : COLOR.text}>
                    {isFocused ? ICON.pointer : " "}
                  </Text>
                  <Text color={isSelected ? COLOR.good : COLOR.text}>
                    {isSelected ? "[x]" : "[ ]"}
                  </Text>
                  <Text> </Text>
                  <Box flexGrow={1} minWidth={0}>
                    <Text color={isFocused ? COLOR.text : COLOR.alt} wrap="truncate-end">
                      {f.path}
                    </Text>
                  </Box>
                  <Box marginLeft={2}>
                    <Text color={COLOR.alt}>{formatBytes(f.length)}</Text>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Panel>
      <Box marginTop={1}>
        {meta ? (
          <Box>
            <Text color={COLOR.accent} bold>↑↓</Text>
            <Text color={COLOR.text}> navigate  </Text>
            <Text color={COLOR.accent} bold>␣</Text>
            <Text color={COLOR.text}> toggle  </Text>
            <PromptHints submitLabel="download" />
          </Box>
        ) : (
          <Box>
            <Text color={COLOR.alt}>esc</Text>
            <Text dimColor> cancel</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
