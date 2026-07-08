import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useStore, usePeers } from "../store";
import { Panel } from "./Panel";
import { COLOR } from "../theme";
import { formatBytes, formatBytesPerSec, truncate } from "../../util/format";

export function PeerInspector({ id }: { id: string }) {
  const { queue, contentWidth, region } = useStore();
  const peers = usePeers(queue, id);
  const [sortMode, setSortMode] = useState<"down" | "up" | "dl" | "ul">("down");

  useInput(
    (input) => {
      if (input === "s") {
        setSortMode((prev) => {
          if (prev === "down") return "up";
          if (prev === "up") return "dl";
          if (prev === "dl") return "ul";
          return "down";
        });
      }
    },
    { isActive: region === "content" },
  );

  const activeItem = queue.getItems().find((i) => i.id === id);
  const seedItem = queue.getSeeds().find((i) => i.id === id);
  const historyItem = queue.getHistory().find((i) => i.id === id);
  const name = activeItem?.name || seedItem?.name || historyItem?.name || "Unknown";
  const isActive = !!(activeItem || seedItem);

  const sortedPeers = peers
    ? [...peers].sort((a, b) => {
        if (sortMode === "down") return b.downSpeed - a.downSpeed;
        if (sortMode === "up") return b.upSpeed - a.upSpeed;
        if (sortMode === "dl") return b.downloaded - a.downloaded;
        if (sortMode === "ul") return b.uploaded - a.uploaded;
        return 0;
      })
    : [];

  const hProps = (mode: string) => ({
    color: sortMode === mode ? COLOR.accent : COLOR.alt,
    bold: true,
  });

  return (
    <Panel title={`Peers: ${truncate(name, 40)}`} width={contentWidth}>
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {!isActive ? (
          <Box marginTop={1}>
            <Text dimColor>Cannot inspect peers: Torrent is not active.</Text>
          </Box>
        ) : sortedPeers.length === 0 ? (
          <Box marginTop={1}>
            <Text dimColor>Connecting to swarm...</Text>
          </Box>
        ) : (
          <>
            <Box marginBottom={1}>
              <Box width={18} flexShrink={0}><Text color={COLOR.alt} bold>IP</Text></Box>
              <Box flexGrow={1}><Text color={COLOR.alt} bold>Client</Text></Box>
              <Box width={12} flexShrink={0} justifyContent="flex-end"><Text {...hProps("down")}>Down</Text></Box>
              <Box width={12} flexShrink={0} justifyContent="flex-end"><Text {...hProps("up")}>Up</Text></Box>
              <Box width={12} flexShrink={0} justifyContent="flex-end"><Text {...hProps("dl")}>DL Bytes</Text></Box>
              <Box width={12} flexShrink={0} justifyContent="flex-end"><Text {...hProps("ul")}>UL Bytes</Text></Box>
            </Box>
            {sortedPeers.map((p, i) => {
              const clientStr = p.client && p.client !== "Unknown" ? p.client : p.peerId;
              return (
                <Box key={`${p.ip}-${i}`}>
                  <Box width={18} flexShrink={0}><Text>{truncate(p.ip, 16)}</Text></Box>
                  <Box flexGrow={1}><Text>{truncate(clientStr, 24)}</Text></Box>
                  <Box width={12} flexShrink={0} justifyContent="flex-end"><Text>{p.downSpeed > 0 ? formatBytesPerSec(p.downSpeed) : "-"}</Text></Box>
                  <Box width={12} flexShrink={0} justifyContent="flex-end"><Text>{p.upSpeed > 0 ? formatBytesPerSec(p.upSpeed) : "-"}</Text></Box>
                  <Box width={12} flexShrink={0} justifyContent="flex-end"><Text>{p.downloaded > 0 ? formatBytes(p.downloaded) : "-"}</Text></Box>
                  <Box width={12} flexShrink={0} justifyContent="flex-end"><Text>{p.uploaded > 0 ? formatBytes(p.uploaded) : "-"}</Text></Box>
                </Box>
              );
            })}
          </>
        )}
      </Box>
    </Panel>
  );
}
