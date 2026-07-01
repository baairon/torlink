import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useStore, useQueueItems, useQueueHistory, type DownloadFocus } from "../store";
import { Panel } from "./Panel";
import { ProgressBar } from "./ProgressBar";
import { wrapStep, windowStart } from "../move";
import { COLOR, GUTTER, ICON, SOURCE_STYLE } from "../theme";
import {
  cleanText,
  formatBytes,
  formatBytesPerSec,
  formatEtaShort,
  formatRelative,
  truncate,
} from "../../util/format";
import type { QueueItem } from "../../download/types";
import type { HistoryItem } from "../../download/history";

const ROWS_PER_ACTIVE = 2;
const MARK = 2;

const PAUSED = "#7c7785";

function statusColor(status: QueueItem["status"]): string {
  if (status === "failed") return COLOR.bad;
  if (status === "paused") return PAUSED;
  return COLOR.accent;
}

function statusIcon(status: QueueItem["status"]): string {
  if (status === "failed") return ICON.error;
  if (status === "paused") return ICON.pause;
  return ICON.down;
}

function rightStats(it: QueueItem): string {
  if (it.status === "downloading") {
    const speed = formatBytesPerSec(it.speed) || "…";
    const eta = it.eta ? `  ${formatEtaShort(it.eta)}` : "";
    return `${it.progress}%  ${speed}  ${ICON.peer}${it.peers}${eta}`;
  }
  if (it.status === "paused") return `paused  ${it.progress}%`;
  return truncate(it.error || "failed", 28);
}

export function Downloads() {
  const { queue, region, contentWidth, listRows, startDownload, setDownloadFocus } = useStore();
  const active = useQueueItems(queue);
  const recent = useQueueHistory(queue);
  const focused = region === "content";

  const total = active.length + recent.length;
  const [cursor, setCursor] = useState(0);
  const clamped = Math.min(cursor, Math.max(0, total - 1));
  const inActive = clamped < active.length;
  const recentCursor = clamped - active.length;

  useInput(
    (input, key) => {
      if (key.upArrow || input === "k") setCursor(wrapStep(clamped, -1, total));
      else if (key.downArrow || input === "j") setCursor(wrapStep(clamped, 1, total));
      else if (input === "f") queue.retryFailed();
      else if (input === "x") queue.clearHistory();
      else if (inActive) {
        const it = active[clamped];
        if (!it) return;
        if (input === "c") queue.cancel(it.id);
        else if (input === "p") queue.togglePause(it.id);
      } else {
        const h = recent[recentCursor];
        if (!h) return;
        if (key.return || input === "d")
          startDownload({
            id: h.id,
            name: h.name,
            magnet: h.magnet,
            source: h.source,
            sizeBytes: h.sizeBytes,
          });
        else if (input === "c") queue.removeHistory(h.id);
      }
    },
    { isActive: focused && total > 0 },
  );

  let focusKind: DownloadFocus | null = null;
  if (focused && total > 0) {
    if (!inActive) focusKind = "recent";
    else {
      const st = active[clamped]?.status;
      if (st === "downloading" || st === "paused" || st === "failed") focusKind = st;
    }
  }
  useEffect(() => {
    setDownloadFocus(focusKind);
    return () => setDownloadFocus(null);
  }, [focusKind, setDownloadFocus]);

  const panelH = Math.max(5, listRows - 1);

  if (total === 0) {
    return (
      <Panel title="downloads" width={contentWidth} focused={focused} height={panelH}>
        <Text dimColor>No downloads yet. Find something and press d to grab it.</Text>
      </Panel>
    );
  }

  const hasActive = active.length > 0;
  const hasRecent = recent.length > 0;
  const headerRows = hasRecent ? 1 : 0;
  const ceiling = Math.max(1, panelH - 1);

  let gapRows = hasActive && hasRecent ? 1 : 0;
  let maxActive = 0;
  let maxRecent = 0;
  if (!hasRecent) {
    maxActive = Math.max(1, Math.floor(ceiling / ROWS_PER_ACTIVE));
  } else if (!hasActive) {
    maxRecent = Math.max(1, ceiling - headerRows);
  } else {
    let budget = ceiling - headerRows - gapRows;
    if (budget < ROWS_PER_ACTIVE + 1) {
      gapRows = 0;
      budget = ceiling - headerRows;
    }
    const activeRowCap = Math.max(ROWS_PER_ACTIVE, Math.floor(budget * 0.55));
    maxActive = Math.min(active.length, Math.max(1, Math.floor(activeRowCap / ROWS_PER_ACTIVE)));
    maxRecent = Math.max(1, budget - maxActive * ROWS_PER_ACTIVE);
  }

  const activeStart = windowStart(inActive ? clamped : 0, active.length, maxActive);
  const activeVisible = active.slice(activeStart, activeStart + maxActive);
  const recentStart = windowStart(inActive ? 0 : recentCursor, recent.length, maxRecent);
  const recentVisible = recent.slice(recentStart, recentStart + maxRecent);

  const inner = contentWidth - 4;
  const gap = 2;
  const barW = Math.max(8, Math.min(28, Math.floor(inner * 0.4)));
  const statsW = Math.max(6, inner - MARK - GUTTER - barW - gap);

  const count = hasActive ? `(${active.length})` : undefined;

  return (
    <Panel title="downloads" width={contentWidth} focused={focused} count={count} height={panelH}>
      {activeVisible.map((it, i) => {
        const here = activeStart + i === clamped && focused && inActive;
        const sc = statusColor(it.status);
        const ss = SOURCE_STYLE[it.source ?? "fitgirl"];
        return (
          <Box key={it.id} flexDirection="column">
            <Box>
              <Box width={MARK} flexShrink={0}>
                <Text color={COLOR.accent} bold>
                  {here ? ICON.pointer : ""}
                </Text>
              </Box>
              <Box width={GUTTER} flexShrink={0}>
                <Text color={sc}>{statusIcon(it.status)}</Text>
              </Box>
              <Box flexGrow={1} minWidth={0}>
                <Text
                  wrap="truncate-end"
                  bold={here}
                  color={here ? COLOR.accent : undefined}
                  dimColor={!here}
                >
                  {cleanText(it.name)}
                </Text>
              </Box>
              <Box width={10} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                <Text dimColor>{it.totalBytes > 0 ? formatBytes(it.totalBytes) : "-"}</Text>
              </Box>
              <Box width={4} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                <Text color={it.source ? ss.color : undefined} dimColor={!it.source || !here}>
                  {it.source ? ss.tag : "mag"}
                </Text>
              </Box>
            </Box>
            <Box>
              <Box width={MARK + GUTTER} flexShrink={0} />
              <ProgressBar
                pct={it.progress}
                width={barW}
                color={sc}
                animate={it.status === "downloading"}
              />
              <Box marginLeft={gap} flexShrink={0}>
                <Text dimColor>{truncate(rightStats(it), statsW)}</Text>
              </Box>
            </Box>
          </Box>
        );
      })}

      {hasRecent ? (
        <Box marginTop={gapRows ? 1 : 0}>
          <Text dimColor>{`Recently downloaded${recent.length > 1 ? `  (${recent.length})` : ""}`}</Text>
        </Box>
      ) : null}

      {recentVisible.map((h: HistoryItem, i) => {
        const here = recentStart + i === recentCursor && focused && !inActive;
        const ss = SOURCE_STYLE[h.source ?? "fitgirl"];
        const when = formatRelative(h.completedAt / 1000);
        return (
          <Box key={h.id}>
            <Box width={MARK} flexShrink={0}>
              <Text color={COLOR.accent} bold>
                {here ? ICON.pointer : ""}
              </Text>
            </Box>
            <Box width={GUTTER} flexShrink={0}>
              <Text color={COLOR.good} dimColor={!here}>
                {ICON.done}
              </Text>
            </Box>
            <Box flexGrow={1} minWidth={0}>
              <Text
                wrap="truncate-end"
                bold={here}
                color={here ? COLOR.accent : undefined}
                dimColor={!here}
              >
                {cleanText(h.name)}
              </Text>
            </Box>
            <Box width={10} flexShrink={0} marginLeft={1} justifyContent="flex-end">
              <Text dimColor>{h.sizeBytes > 0 ? formatBytes(h.sizeBytes) : "-"}</Text>
            </Box>
            <Box width={12} flexShrink={0} marginLeft={1} justifyContent="flex-end">
              <Text dimColor>{when || "-"}</Text>
            </Box>
            <Box width={4} flexShrink={0} marginLeft={1} justifyContent="flex-end">
              <Text color={h.source ? ss.color : undefined} dimColor={!h.source || !here}>
                {h.source ? ss.tag : "mag"}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Panel>
  );
}
