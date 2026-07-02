import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Box, Text, useInput } from "ink";
import { useStore, CATEGORIES } from "../store";
import { Spinner } from "./Spinner";
import { SearchBar } from "./SearchBar";
import { Panel } from "./Panel";
import { Rule } from "./Rule";
import { useConcurrentSearch } from "../hooks/useConcurrentSearch";
import { getSource, SOURCES } from "../../sources/registry";
import { wrapStep, windowStart, resultsPanelOuter } from "../move";
import { sortResults, nextSort, sortLabel, sortArrow, type Sort, type SortField } from "../sort";
import { COLOR, GUTTER, ICON, SOURCE_STYLE } from "../theme";
import { cleanText, formatBytes, formatRelative, truncate } from "../../util/format";
import type { Source, TorrentResult } from "../../sources/types";

type Mode = "list" | "search" | "detail";

const PLACEHOLDER = "Search or paste a magnet link…";

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box>
      <Box width={9} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexGrow={1} minWidth={0}>{value}</Box>
    </Box>
  );
}

interface DetailProps {
  r: TorrentResult;
  width: number;
  listHeight: number;
  focused: boolean;
  onClose: () => void;
}

function Detail({ r, width, listHeight, focused, onClose }: DetailProps) {
  const { queue, config, startDownload, copyMagnet } = useStore();
  const ss = SOURCE_STYLE[r.source];
  const date = formatRelative(r.added);

  const [fileList, setFileList] = useState<{ path: string; length: number }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If already in queue, check if it has fileList
    const qItem = queue.getItems().find((it) => it.id === r.infoHash);
    if (qItem && qItem.fileList) {
      setFileList(qItem.fileList.map((f) => ({ path: f.path, length: f.length })));
      setSelected(new Set(qItem.selectedIndices ?? qItem.fileList.map((_, i) => i)));
      return;
    }

    if (r.numFiles && r.numFiles <= 1) {
      return;
    }

    setLoading(true);
    setError(null);

    let active = true;
    const tempId = `temp-${r.infoHash}`;

    try {
      queue.engine.add(
        tempId,
        r.magnet,
        config.downloadDir,
        {
          onMetadata: (meta) => {
            if (!active) return;
            if (meta.fileList) {
              setFileList(meta.fileList);
              setSelected(new Set(meta.fileList.map((_, i) => i)));
            }
            setLoading(false);
            queue.engine.applyFileSelection(tempId, new Set());
          },
          onError: (msg) => {
            if (!active) return;
            setError(msg);
            setLoading(false);
          },
        },
        config.trackers,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }

    return () => {
      active = false;
      queue.engine.remove(tempId);
    };
  }, [r.infoHash, queue, config, r.magnet, r.numFiles]);

  const showFileList = fileList && fileList.length > 1;

  useInput(
    (input, key) => {
      if (key.escape) {
        onClose();
      } else if (input === "y") {
        copyMagnet({ name: r.name, magnet: r.magnet });
      } else if (input === "d") {
        startDownload({
          id: r.infoHash,
          name: r.name,
          magnet: r.magnet,
          source: r.source,
          sizeBytes: r.sizeBytes,
          selectedIndices: showFileList ? Array.from(selected) : undefined,
        });
        onClose();
      } else if (showFileList && fileList) {
        if (key.upArrow || input === "k") {
          setCursor((c) => Math.max(0, c - 1));
        } else if (key.downArrow || input === "j") {
          setCursor((c) => Math.min(fileList.length - 1, c + 1));
        } else if (input === " ") {
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(cursor)) next.delete(cursor);
            else next.add(cursor);
            return next;
          });
        } else if (input === "a") {
          setSelected((prev) => {
            if (prev.size === fileList.length) return new Set();
            return new Set(fileList.map((_, i) => i));
          });
        } else if (input === "n") {
          setSelected(new Set());
        }
      }
    },
    { isActive: focused },
  );

  const health =
    r.seeders || r.leechers ? (
      <Text>
        <Text color={r.seeders > 0 ? COLOR.good : undefined} bold={r.seeders > 0}>
          {r.seeders}
        </Text>
        <Text dimColor>{` seeders ${ICON.dot} ${r.leechers} leechers`}</Text>
      </Text>
    ) : (
      <Text dimColor>unknown</Text>
    );

  const fileBoxHeight = Math.max(3, listHeight - 11);
  const fileStart = windowStart(cursor, fileList?.length ?? 0, fileBoxHeight);
  const visibleFiles = fileList ? fileList.slice(fileStart, fileStart + fileBoxHeight) : [];

  return (
    <Box flexDirection="column">
      <Box>
        <Box flexGrow={1} minWidth={0}>
          <Text bold color={COLOR.text} wrap="truncate-end">
            {cleanText(r.name)}
          </Text>
        </Box>
        <Box flexShrink={0} marginLeft={2}>
          <Text color={ss.color} bold>
            {ss.tag}
          </Text>
        </Box>
      </Box>
      <Rule width={width} />
      <Box marginTop={1} flexDirection="column">
        <DetailRow
          label="Size"
          value={
            r.sizeBytes > 0 ? (
              <Text color={COLOR.text}>{formatBytes(r.sizeBytes)}</Text>
            ) : (
              <Text dimColor>unknown</Text>
            )
          }
        />
        <DetailRow label="Health" value={health} />
        {r.numFiles ? (
          <DetailRow label="Files" value={<Text dimColor>{String(r.numFiles)}</Text>} />
        ) : null}
        {date ? <DetailRow label="Added" value={<Text dimColor>{date}</Text>} /> : null}
        <DetailRow
          label="Hash"
          value={
            <Text color={COLOR.alt} dimColor wrap="truncate-end">
              {r.infoHash}
            </Text>
          }
        />
        <DetailRow
          label="Magnet"
          value={
            <Text color={COLOR.alt} dimColor wrap="truncate-end">
              {r.magnet}
            </Text>
          }
        />
      </Box>

      {loading && (
        <Box marginTop={1}>
          <Spinner label="Loading file list…" />
        </Box>
      )}

      {error && (
        <Box marginTop={1}>
          <Text color={COLOR.bad}>Failed to load files: {error}</Text>
        </Box>
      )}

      {showFileList && fileList && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text bold dimColor>Files selection checklist:</Text>
          </Box>
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={COLOR.accent}
            paddingX={1}
            height={fileBoxHeight + 2}
          >
            {visibleFiles.map((file, i) => {
              const globalIdx = fileStart + i;
              const isFocused = globalIdx === cursor;
              const isChecked = selected.has(globalIdx);

              const displayPath = file.path.includes("/")
                ? file.path.substring(file.path.indexOf("/") + 1)
                : file.path;

              return (
                <Box key={file.path}>
                  <Box width={2} flexShrink={0}>
                    <Text color={COLOR.accent}>{isFocused ? ICON.pointer : ""}</Text>
                  </Box>
                  <Box width={4} flexShrink={0}>
                    <Text color={isChecked ? COLOR.accent : COLOR.alt}>
                      {isChecked ? "[x]" : "[ ]"}
                    </Text>
                  </Box>
                  <Box flexGrow={1} minWidth={0}>
                    <Text wrap="truncate-end" color={isFocused ? COLOR.accent : COLOR.text} dimColor={!isFocused && !isChecked}>
                      {truncate(cleanText(displayPath), width - 30)}
                    </Text>
                  </Box>
                  <Box width={10} flexShrink={0} justifyContent="flex-end">
                    <Text dimColor>{formatBytes(file.length)}</Text>
                  </Box>
                </Box>
              );
            })}
          </Box>
          <Box justifyContent="space-between" width={width}>
            <Text dimColor>
              [space] toggle  .  [a] all  .  [n] none
            </Text>
            <Text color={COLOR.good}>
              Selected: {selected.size} / {fileList.length} files ({formatBytes(Array.from(selected).reduce((sum, idx) => sum + (fileList[idx]?.length ?? 0), 0))})
            </Text>
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={COLOR.accent} bold>
          d
        </Text>
        <Text color={COLOR.text}> Download</Text>
        <Text dimColor>{`     ${ICON.dot}     `}</Text>
        <Text color={COLOR.accent} bold>
          y
        </Text>
        <Text color={COLOR.text}> Copy magnet</Text>
        <Text dimColor>{`     ${ICON.dot}     `}</Text>
        <Text color={COLOR.alt}>esc</Text>
        <Text dimColor> back</Text>
      </Box>
    </Box>
  );
}

export function Results() {
  const {
    query,
    submitQuery,
    section,
    region,
    setRegion,
    setCaptureMode,
    startDownload,
    copyMagnet,
    contentWidth,
    listRows,
  } = useStore();

  const search = useConcurrentSearch(query);

  const [sort, setSort] = useState<Sort>("none");
  const results = useMemo(() => {
    const cat = CATEGORIES.find((c) => c.key === section);
    const base = cat?.group
      ? search.results.filter((r) => getSource(r.source).group === cat.group)
      : search.results;
    return sortResults(base, sort);
  }, [search.results, section, sort]);

  const focused = region === "content";
  const [mode, setMode] = useState<Mode>("list");
  const [cursor, setCursor] = useState(0);
  const [detail, setDetail] = useState<TorrentResult | null>(null);

  useEffect(() => {
    setCursor(0);
  }, [results]);

  useEffect(() => {
    if (!focused) return;
    setCaptureMode(mode === "search" ? "text" : mode === "detail" ? "esc" : "none");
    return () => setCaptureMode("none");
  }, [mode, focused, setCaptureMode]);

  useEffect(() => {
    if (!focused) setMode("list");
  }, [focused]);

  const clamped = Math.min(cursor, Math.max(0, results.length - 1));

  const searchH = 3;
  const panelOuter = resultsPanelOuter(listRows, searchH);
  const listHeight = Math.max(3, panelOuter - 4);
  const pageJump = Math.max(1, listHeight - 1);

  const openDownload = (r: TorrentResult): void =>
    startDownload({
      id: r.infoHash,
      name: r.name,
      magnet: r.magnet,
      source: r.source,
      sizeBytes: r.sizeBytes,
    });

  const copyResultMagnet = (r: TorrentResult): void =>
    copyMagnet({ name: r.name, magnet: r.magnet });

  useInput(
    (input, key) => {
      if (input === "/") {
        setMode("search");
        return;
      }
      if (key.upArrow || input === "k") {
        if (results.length > 0 && clamped > 0) setCursor(clamped - 1);
        else setMode("search");
        return;
      }
      if (results.length === 0) return;
      if (key.downArrow || input === "j") setCursor(wrapStep(clamped, 1, results.length));
      else if (key.pageUp) setCursor(Math.max(0, clamped - pageJump));
      else if (key.pageDown) setCursor(Math.min(results.length - 1, clamped + pageJump));
      else if (key.return) {
        const r = results[clamped];
        if (r) {
          setDetail(r);
          setMode("detail");
        }
      } else if (input === "d") {
        const r = results[clamped];
        if (r) openDownload(r);
      } else if (input === "y") {
        const r = results[clamped];
        if (r) copyResultMagnet(r);
      } else if (input === "s") {
        setSort((cur) => nextSort(cur));
      }
    },
    { isActive: focused && mode === "list" },
  );



  useInput(
    (_input, key) => {
      if (key.escape) setMode("list");
    },
    { isActive: focused && mode === "search" },
  );

  const onSubmit = (value: string): void => {
    setMode("list");
    submitQuery(value);
  };

  const browsing = query.trim() === "";
  const erroredCount = useMemo(
    () => Object.values(search.perSource).filter((s) => s.error).length,
    [search.perSource],
  );
  const activeCat = CATEGORIES.find((c) => c.key === section);
  const tabSources = activeCat?.group ? SOURCES.filter((s) => s.group === activeCat.group) : SOURCES;
  const tabErrored =
    tabSources.length > 0 && tabSources.every((s) => search.perSource[s.id]?.error);
  const showStats = useMemo(
    () => results.some((r) => r.sizeBytes > 0 || r.seeders > 0),
    [results],
  );
  const numW = Math.max(2, String(results.length).length);

  const outageCodes = (sources: readonly Source[]): string => {
    const codes = [
      ...new Set(sources.map((s) => search.perSource[s.id]?.code).filter(Boolean)),
    ];
    return codes.length ? ` (${codes.join(", ")})` : "";
  };

  const sortNote = sort === "none" ? "" : `  ${ICON.dot} sort: ${sortLabel(sort)}`;

  const status = () => {
    if (search.loading) {
      if (results.length > 0)
        return <Text dimColor>{`searching… ${search.done}/${search.total} sources${sortNote}`}</Text>;
      return (
        <Spinner label={`${browsing ? "Loading" : "Searching"} ${search.done}/${search.total} sources`} />
      );
    }
    if (results.length === 0) {
      if (erroredCount >= search.total) {
        const downAll = SOURCES.filter((s) => search.perSource[s.id]?.error);
        return (
          <Text color={COLOR.warn}>
            {`Couldn't reach any source. They may be down${outageCodes(downAll)}.`}
          </Text>
        );
      }
      if (tabErrored && activeCat) {
        const down = tabSources.filter((s) => search.perSource[s.id]?.error);
        const who = down.length === 1 ? "The source" : `All ${down.length} sources`;
        return (
          <Text color={COLOR.warn}>
            {`Couldn't reach ${activeCat.label}. ${who} may be down${outageCodes(down)}.`}
          </Text>
        );
      }
      if (search.results.length > 0 && activeCat?.group)
        return <Text dimColor>{`No ${activeCat.label.toLowerCase()} results yet. Try another tab or a search.`}</Text>;
      return (
        <Text dimColor>
          {browsing ? "Nothing new right now." : `No results for "${truncate(query, 28)}".`}
        </Text>
      );
    }
    const note = erroredCount > 0 ? `  (${erroredCount} source${erroredCount === 1 ? "" : "s"} down)` : "";
    const head = browsing
      ? "newest across all sources"
      : `${results.length} result${results.length === 1 ? "" : "s"}`;
    return <Text dimColor>{`${head}${note}${sortNote}`}</Text>;
  };

  const sortMark = (field: SortField, label: string): ReactNode => {
    if (sort === "none" || sort.field !== field) return label;
    return (
      <>
        <Text color={COLOR.accent} bold>{sortArrow(sort.dir)}</Text>
        {label}
      </>
    );
  };

  const start = windowStart(clamped, results.length, listHeight);
  const visible = results.slice(start, start + listHeight);
  const count = results.length > 0 ? `(${results.length})` : undefined;

  return (
    <Box flexDirection="column">
      <SearchBar
        width={contentWidth}
        value={query}
        editing={mode === "search"}
        placeholder={PLACEHOLDER}
        onSubmit={onSubmit}
        onExitDown={() => setMode("list")}
        onExitLeft={() => setRegion("sidebar")}
      />
      <Box marginTop={1}>
        <Panel
          title={mode === "detail" ? "details" : browsing ? "latest" : "results"}
          width={contentWidth}
          focused={focused && mode !== "search"}
          count={mode === "detail" ? undefined : count}
          height={panelOuter}
        >
          {mode === "detail" && detail ? (
            <Detail
              r={detail}
              width={Math.max(10, contentWidth - 4)}
              listHeight={listHeight}
              focused={focused}
              onClose={() => {
                setMode("list");
                setDetail(null);
              }}
            />
          ) : (
            <>
              <Box>{status()}</Box>
              <Box flexDirection="column" marginTop={results.length > 0 ? 1 : 0}>
                {results.length > 0 ? (
                  <Box>
                    <Box width={GUTTER} flexShrink={0} />
                    <Box width={numW} flexShrink={0} justifyContent="flex-end">
                      <Text bold dimColor>#</Text>
                    </Box>
                    <Box flexGrow={1} minWidth={0} marginLeft={1}>
                      <Text bold dimColor>Name</Text>
                    </Box>
                    {showStats ? (
                      <>
                        <Box width={10} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                          <Text bold dimColor>{sortMark("size", "Size")}</Text>
                        </Box>
                        <Box width={9} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                          <Text bold dimColor>{sortMark("seeders", "Seed:Lch")}</Text>
                        </Box>
                      </>
                    ) : (
                      <Box width={12} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                        <Text bold dimColor>Added</Text>
                      </Box>
                    )}
                    <Box width={4} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                      <Text bold dimColor>{sortMark("source", "Src")}</Text>
                    </Box>
                  </Box>
                ) : null}
                {visible.map((r, i) => {
                  const index = start + i;
                  const here = index === clamped && focused && mode === "list";
                  const ss = SOURCE_STYLE[r.source];
                  return (
                    <Box key={r.infoHash}>
                      <Box width={GUTTER} flexShrink={0}>
                        <Text color={COLOR.accent}>{here ? ICON.pointer : ""}</Text>
                      </Box>
                      <Box width={numW} flexShrink={0} justifyContent="flex-end">
                        <Text dimColor>{index + 1}</Text>
                      </Box>
                      <Box flexGrow={1} minWidth={0} marginLeft={1}>
                        <Text
                          wrap="truncate-end"
                          color={here ? COLOR.accent : undefined}
                          dimColor={!here}
                          bold={here}
                        >
                          {cleanText(r.name)}
                        </Text>
                      </Box>
                      {showStats ? (
                        <>
                          <Box width={10} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                            <Text dimColor>{r.sizeBytes > 0 ? formatBytes(r.sizeBytes) : "-"}</Text>
                          </Box>
                          <Box width={9} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                            <Text color={r.seeders > 0 ? COLOR.good : undefined} dimColor={r.seeders === 0}>
                              {r.seeders || r.leechers ? `${r.seeders}:${r.leechers}` : "-"}
                            </Text>
                          </Box>
                        </>
                      ) : (
                        <Box width={12} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                          <Text dimColor>{formatRelative(r.added) || "-"}</Text>
                        </Box>
                      )}
                      <Box width={4} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                        <Text color={ss.color} dimColor={!here}>
                          {ss.tag}
                        </Text>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </>
          )}
        </Panel>
      </Box>
    </Box>
  );
}
