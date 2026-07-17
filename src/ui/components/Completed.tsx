import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useStore, useQueueHistory, useSeeds } from "../store";
import { Panel } from "./Panel";
import { wrapStep, windowStart } from "../move";
import { COLOR, ICON, sourceStyle } from "../theme";
import { getCompletedDir } from "../../config/folder";
import { cleanText, formatBytes, truncate } from "../../util/format";

const MARK = 2;
const SIZE_W = 10;
const SRC_W = 4;

export function Completed() {
  const { queue, region, contentWidth, listRows, openDownloadFolder, setInspectingId, inspectingId, inspectingPeersId, requestConfirm } =
    useStore();
  const history = useQueueHistory(queue);
  const seeds = useSeeds(queue);
  
  const completedHistory = history.filter((h) => !seeds.has(h.id));
  const focused = region === "content";

  const total = completedHistory.length;
  const [cursor, setCursor] = useState(0);
  const clamped = Math.min(cursor, Math.max(0, total - 1));

  useInput(
    (input, key) => {
      if (key.upArrow || input === "k") setCursor(wrapStep(clamped, -1, total));
      else if (key.downArrow || input === "j") setCursor(wrapStep(clamped, 1, total));
      else if (input === "c") {
        const h = completedHistory[clamped];
        if (h) {
          requestConfirm(`Remove and delete '${truncate(cleanText(h.name), 40)}'?`, () => queue.removeHistory(h.id));
        }
      } else if (input === "x") {
        requestConfirm("Clear completed downloads history? Files will be deleted.", () => queue.clearHistory());
      } else if (input === "e") {
        const h = completedHistory[clamped];
        if (h) openDownloadFolder(getCompletedDir(h.dir));
      } else if (input === "i" || input === "Enter" || input === " ") {
        const h = completedHistory[clamped];
        if (h) setInspectingId(h.id);
      }
    },
    { isActive: focused && total > 0 && !inspectingId && !inspectingPeersId },
  );

  const panelH = Math.max(5, listRows - 1);

  if (total === 0) {
    return (
      <Panel title="completed" width={contentWidth} focused={focused} height={panelH}>
        <Text dimColor>Nothing here yet. Torrents you stop seeding will appear here.</Text>
      </Panel>
    );
  }

  const rows = Math.max(1, panelH - 2);
  const start = windowStart(clamped, total, rows);
  const visible = completedHistory.slice(start, start + rows);

  return (
    <Panel
      title="completed"
      width={contentWidth}
      focused={focused}
      height={panelH}
      count={String(total)}
    >
      <Box flexDirection="column" width="100%">
        <Box marginBottom={1} paddingRight={1}>
          <Box width={MARK} flexShrink={0} />
          <Box flexGrow={1} minWidth={0} marginLeft={1}>
            <Text bold dimColor>Name</Text>
          </Box>
          <Box width={SIZE_W} flexShrink={0} marginLeft={1} justifyContent="flex-end">
            <Text bold dimColor>Size</Text>
          </Box>
          <Box width={SRC_W} flexShrink={0} marginLeft={1} justifyContent="flex-end">
            <Text bold dimColor>Src</Text>
          </Box>
        </Box>

        <Box flexDirection="column" flexGrow={1}>
          {visible.map((h, i) => {
            const index = start + i;
            const here = index === clamped && focused;
            const ss = sourceStyle(h.source);

            return (
              <Box key={h.id} width="100%" paddingRight={1}>
                <Box width={MARK} flexShrink={0}>
                  {here ? (
                    <Text color={COLOR.accent} bold>
                      {ICON.pointer}
                    </Text>
                  ) : null}
                </Box>
                <Box flexGrow={1} minWidth={0} marginLeft={1}>
                  <Text
                    wrap="truncate-end"
                    color={here ? COLOR.accent : undefined}
                    dimColor={!here}
                    bold={here}
                  >
                    {cleanText(h.name)}
                  </Text>
                </Box>
                <Box width={SIZE_W} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                  <Text dimColor>{formatBytes(h.sizeBytes)}</Text>
                </Box>
                <Box width={SRC_W} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                  <Text color={ss.color} dimColor={!here}>
                    {ss.tag}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Panel>
  );
}
