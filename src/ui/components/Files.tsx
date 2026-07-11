import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { useFiles, useStore } from "../store";
import { COLOR, ICON } from "../theme";
import { cleanText, formatBytes } from "../../util/format";
import path from "node:path";
import { openFolder } from "../../util/openFolder";

import { getDownloadsDir, getSeedingDir, getCompletedDir } from "../../config/folder";

export function Files() {
  const { queue, inspectingId, inspectingMagnet, toggleFileSelection, listRows, setNotice, setInspectFocusSelected } = useStore();
  const files = useFiles(queue, inspectingId, inspectingMagnet);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    setCursor(0);
  }, [inspectingId]);

  useEffect(() => {
    if (files && files[cursor]) {
      setInspectFocusSelected(files[cursor].selected);
    }
  }, [files, cursor, setInspectFocusSelected]);

  useInput(
    (input, key) => {
      if (!files || files.length === 0) return;
      if (key.downArrow || input === "j") setCursor((c) => Math.min(c + 1, files.length - 1));
      else if (key.upArrow || input === "k") setCursor((c) => Math.max(c - 1, 0));
      else if (input === " ") {
        const f = files[cursor]!;
        toggleFileSelection(inspectingId!, f.path, !f.selected);

      } else if (key.return) {
        const f = files[cursor]!;
        const it = queue.getItems().find(i => i.id === inspectingId);
        let baseDir = "";
        if (it) {
          baseDir = getDownloadsDir(it.dir);
        } else {
          const h = queue.getHistory().find(i => i.id === inspectingId);
          if (h) {
            const isSeeding = queue.getSeed(h.id);
            baseDir = isSeeding ? getSeedingDir(h.dir) : getCompletedDir(h.dir);
          }
        }
        if (baseDir) {
          const absPath = path.join(baseDir, f.path);
          openFolder(absPath).then((ok) => {
            if (ok) setNotice("Opened file.");
            else setNotice("Couldn't open file.");
          });
        }
      }
    },
    { isActive: !!inspectingId }
  );

  if (!files || files.length === 0) {
    return (
      <Box height={listRows} justifyContent="center" alignItems="center">
        <Text dimColor>Loading files...</Text>
      </Box>
    );
  }

  // Handle scrolling
  const start = Math.max(0, Math.min(cursor - Math.floor(listRows / 2), files.length - listRows));
  const visible = files.slice(start, start + listRows);

  const numW = Math.max(2, String(files.length).length);

  return (
    <Box flexDirection="column" marginTop={1} height={listRows + 1} overflow="hidden">
      <Box>
        <Box width={2} flexShrink={0} />
        <Box width={numW} flexShrink={0} justifyContent="flex-end"><Text bold dimColor>#</Text></Box>
        <Box flexGrow={1} minWidth={0} marginLeft={1}><Text bold dimColor>File</Text></Box>
        <Box width={10} flexShrink={0} marginLeft={1} justifyContent="flex-end"><Text bold dimColor>Size</Text></Box>
        <Box width={8} flexShrink={0} marginLeft={1} justifyContent="flex-end"><Text bold dimColor>Done</Text></Box>
      </Box>
      {visible.map((f, i) => {
        const idx = start + i;
        const here = idx === cursor;
        const pct = f.length > 0 ? (f.downloaded / f.length) * 100 : 0;
        
        return (
          <Box key={f.path}>
            <Box width={2} flexShrink={0}>
              <Text color={COLOR.accent}>{here ? ICON.pointer : "  "}</Text>
            </Box>
            <Box width={numW} flexShrink={0} justifyContent="flex-end">
              <Text dimColor>{idx + 1}</Text>
            </Box>
            <Box flexGrow={1} minWidth={0} marginLeft={1}>
              <Text 
                wrap="truncate-end" 
                color={!f.selected ? COLOR.bad : here ? COLOR.accent : undefined} 
                dimColor={!f.selected ? !here : !here}
                bold={here}
                strikethrough={!f.selected}
              >
                {cleanText(f.path)}
              </Text>
            </Box>
            <Box width={10} flexShrink={0} marginLeft={1} justifyContent="flex-end">
              <Text dimColor>{f.length > 0 ? formatBytes(f.length) : "-"}</Text>
            </Box>
            <Box width={8} flexShrink={0} marginLeft={1} justifyContent="flex-end">
              <Text color={pct >= 100 ? COLOR.good : undefined} dimColor={pct === 0}>
                {pct >= 100 ? "100%" : pct > 0 ? `${pct.toFixed(1)}%` : "-"}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
