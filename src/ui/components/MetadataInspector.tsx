import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useStore } from "../store";
import { Panel } from "./Panel";
import { COLOR, ICON } from "../theme";
import { cleanText, formatBytes, formatRelative, truncate } from "../../util/format";
import type { ExtendedTorrentMeta } from "../../download/engine";

export function MetadataInspector() {
  const {
    queue,
    inspectingMetaId,
    inspectingMetaMagnet,
    setInspectingMetaId,
    contentWidth,
    listRows,
  } = useStore();

  const [meta, setMeta] = useState<ExtendedTorrentMeta | null>(null);

  useEffect(() => {
    if (!inspectingMetaId) {
      setMeta(null);
      return;
    }
    
    let cancelled = false;
    
    void queue.getMetadata(inspectingMetaId, inspectingMetaMagnet ?? undefined).then((m) => {
      if (!cancelled) setMeta(m);
    });
    
    const timer = setInterval(() => {
      void queue.getMetadata(inspectingMetaId, inspectingMetaMagnet ?? undefined).then((m) => {
        if (!cancelled && m) setMeta(m);
      });
    }, 1000);
    
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [queue, inspectingMetaId, inspectingMetaMagnet]);

  useInput(
    (input, key) => {
      if (key.escape || input === "w" || input === "v" || input === "q" || input === "h" || key.leftArrow) {
        setInspectingMetaId(null);
      }
    },
    { isActive: !!inspectingMetaId },
  );

  if (!inspectingMetaId) return null;

  const panelH = Math.max(6, listRows - 1);
  const w = contentWidth;
  const maxTrackers = Math.max(1, panelH - 10);

  return (
    <Panel
      title={`metadata ${ICON.pointer} ${truncate(cleanText(meta?.name || "Loading..."), 36)}`}
      width={w}
      focused={true}
      height={panelH}
    >
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {!meta ? (
          <Box marginTop={1}>
            <Text dimColor>Loading metadata...</Text>
          </Box>
        ) : (
          <>
            <Box>
              <Box width={14} flexShrink={0}><Text color={COLOR.accent} bold>Info Hash</Text></Box>
              <Box flexGrow={1}><Text dimColor>{meta.infoHash}</Text></Box>
            </Box>
            
            <Box>
              <Box width={14} flexShrink={0}><Text color={COLOR.accent} bold>Total Size</Text></Box>
              <Box flexGrow={1}><Text dimColor>{meta.length ? formatBytes(meta.length) : "-"}</Text></Box>
            </Box>

            <Box>
              <Box width={14} flexShrink={0}><Text color={COLOR.accent} bold>Created</Text></Box>
              <Box flexGrow={1}>
                <Text dimColor>
                  {meta.created ? `${meta.created.toISOString().split("T")[0]} (${formatRelative(meta.created.getTime() / 1000)})` : "-"}
                </Text>
              </Box>
            </Box>

            <Box>
              <Box width={14} flexShrink={0}><Text color={COLOR.accent} bold>Created By</Text></Box>
              <Box flexGrow={1}><Text dimColor wrap="truncate-end">{meta.createdBy || "-"}</Text></Box>
            </Box>

            <Box>
              <Box width={14} flexShrink={0}><Text color={COLOR.accent} bold>Comment</Text></Box>
              <Box flexGrow={1}><Text dimColor wrap="truncate-end">{cleanText(meta.comment || "-")}</Text></Box>
            </Box>

            <Box>
              <Box width={14} flexShrink={0}><Text color={COLOR.accent} bold>Pieces</Text></Box>
              <Box flexGrow={1}>
                <Text dimColor>
                  {meta.numPieces ? `${meta.numPieces} pieces` : "-"} 
                  {meta.pieceLength ? ` @ ${formatBytes(meta.pieceLength)}` : ""}
                </Text>
              </Box>
            </Box>

            <Box flexDirection="column" marginTop={1}>
              <Box><Text color={COLOR.accent} bold>Trackers ({meta.announce.length})</Text></Box>
              {meta.announce.length === 0 ? (
                <Text dimColor>No trackers found (DHT / PEX only)</Text>
              ) : (
                meta.announce.slice(0, maxTrackers).map((tr, i) => (
                  <Box key={i} marginLeft={2}>
                    <Text dimColor wrap="truncate-end">{tr}</Text>
                  </Box>
                ))
              )}
              {meta.announce.length > maxTrackers && (
                <Box marginLeft={2}><Text dimColor>... and {meta.announce.length - maxTrackers} more</Text></Box>
              )}
            </Box>
          </>
        )}
      </Box>
    </Panel>
  );
}
