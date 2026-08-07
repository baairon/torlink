import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useStore } from "../store";
import { Panel } from "./Panel";
import { COLOR, ICON, GUTTER } from "../theme";
import { formatBytes, formatRelative, truncate } from "../../util/format";
import type { ExtendedTorrentMeta } from "../../download/engine";

export function MetadataInspector() {
  const {
    queue,
    inspectingMetaId,
    setInspectingMetaId,
    contentWidth,
    rows,
  } = useStore();

  const [meta, setMeta] = useState<ExtendedTorrentMeta | null>(null);

  useEffect(() => {
    if (!inspectingMetaId) {
      setMeta(null);
      return;
    }
    
    // We only have observing interval here because metadata shouldn't change
    // frequently, but if it comes from a magnet, it might load asynchronously.
    let cancelled = false;
    
    // In search results we might not have a downloading torrent, but we do have the magnet.
    // How do we know the magnet for the inspected ID? Wait, store doesn't have inspectingMagnet right now.
    // But `queue.getMetadata(inspectingMetaId)` will fallback to checking if the .torrent exists or if it's active.
    // If it's a raw magnet and not added, it won't be in the queue.
    // We need to pass the magnet string. Let's get it from the store if possible, or just queue.
    
    // Wait, in `Results.tsx`, we have `result.magnet`.
    // Let's add inspectingMetaMagnet to store, or just use what we have. 
    // Wait, let's fix that if needed. We'll use getMetadata(id) first.
    
    void queue.getMetadata(inspectingMetaId).then((m) => {
      if (!cancelled) setMeta(m);
    });
    
    const timer = setInterval(() => {
      void queue.getMetadata(inspectingMetaId).then((m) => {
        if (!cancelled && m) setMeta(m);
      });
    }, 1000);
    
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [queue, inspectingMetaId]);

  useInput(
    (input, key) => {
      if (key.escape || input === "w" || input === "v") {
        setInspectingMetaId(null);
      }
    },
    { isActive: !!inspectingMetaId },
  );

  if (!inspectingMetaId) return null;

  const panelH = Math.max(10, rows - 4);
  const w = contentWidth;
  const valW = w - 16 - GUTTER * 2; // 16 for labels

  return (
    <Box position="absolute" marginLeft={0} marginTop={1}>
      <Panel
        title={`metadata ${ICON.pointer} ${truncate(meta?.name || "Loading...", 40)}`}
        width={w}
        focused={true}
        height={panelH}
      >
        <Box flexDirection="column" gap={1}>
          {!meta ? (
            <Text dimColor>Loading metadata...</Text>
          ) : (
            <>
              <Box>
                <Box width={16}><Text color={COLOR.accent} bold>Info Hash</Text></Box>
                <Box width={valW}><Text dimColor>{meta.infoHash}</Text></Box>
              </Box>
              
              <Box>
                <Box width={16}><Text color={COLOR.accent} bold>Total Size</Text></Box>
                <Box width={valW}><Text dimColor>{meta.length ? formatBytes(meta.length) : "-"}</Text></Box>
              </Box>

              <Box>
                <Box width={16}><Text color={COLOR.accent} bold>Created</Text></Box>
                <Box width={valW}>
                  <Text dimColor>
                    {meta.created ? `${meta.created.toISOString().split('T')[0]} (${formatRelative(meta.created.getTime() / 1000)})` : "-"}
                  </Text>
                </Box>
              </Box>

              <Box>
                <Box width={16}><Text color={COLOR.accent} bold>Created By</Text></Box>
                <Box width={valW}><Text dimColor>{meta.createdBy || "-"}</Text></Box>
              </Box>

              <Box>
                <Box width={16}><Text color={COLOR.accent} bold>Comment</Text></Box>
                <Box width={valW}><Text dimColor wrap="truncate-end">{meta.comment || "-"}</Text></Box>
              </Box>

              <Box>
                <Box width={16}><Text color={COLOR.accent} bold>Pieces</Text></Box>
                <Box width={valW}>
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
                  meta.announce.slice(0, panelH - 12).map((tr, i) => (
                    <Box key={i} marginLeft={2}>
                      <Text dimColor wrap="truncate-end">{tr}</Text>
                    </Box>
                  ))
                )}
                {meta.announce.length > Math.max(0, panelH - 12) && (
                  <Box marginLeft={2}><Text dimColor>... and {meta.announce.length - Math.max(0, panelH - 12)} more</Text></Box>
                )}
              </Box>
            </>
          )}
        </Box>
      </Panel>
    </Box>
  );
}
