import { useRef } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { Logo } from "../components/Logo";
import { SearchBar } from "../components/SearchBar";
import { LOGO_WIDTH } from "../logo";
import { useStore } from "../store";
import { sourcesByGroup } from "../../sources/registry";
import { COLOR, ICON } from "../theme";
import { parseInput } from "../../sources/magnet";

const CATEGORIES = sourcesByGroup()
  .map((g) => g.group.toLowerCase())
  .join(`  ${ICON.dot}  `);

export function Splash() {
  const { submitQuery, startDownload, requestDownloadTo, setView, setRegion, quitAll, cols, rows } =
    useStore();
  const { isRawModeSupported } = useStdin();

  // Track the live text for processing.
  const textRef = useRef("");

  useInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === "c")) quitAll();

      // Ctrl+D: download magnet to a specific folder
      if (key.ctrl && input === "d") {
        const q = textRef.current.trim();
        if (!q) return;
        const magnet = parseInput(q);
        if (!magnet) return;
        requestDownloadTo({
          id: magnet.infoHash,
          name: magnet.name,
          magnet: magnet.magnet,
          returnToSplash: true,
        });
        setView("browser");
      }
    },
    { isActive: isRawModeSupported },
  );

  const handleSubmit = (raw: string) => {
    const q = raw.trim();

    
    if (q) {
      const magnet = parseInput(q);
      if (magnet) {
        startDownload({
          id: magnet.infoHash,
          name: magnet.name,
          magnet: magnet.magnet,
        });
        setView("browser");
        return;
      }
    }

    submitQuery(raw);
  };

  const showLogo = cols >= LOGO_WIDTH + 2;
  const barWidth = Math.max(24, Math.min(cols - 6, 62));

  return (
    <Box
      height={Math.max(1, rows - 1)}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      {showLogo ? (
        <Logo />
      ) : (
        <Text bold color={COLOR.accent}>
          torlink
        </Text>
      )}
      <Box marginTop={2}>
        <Text color={COLOR.text}>A curated, terminal-native torrent downloader.</Text>
      </Box>
      <Box>
        <Text dimColor>{CATEGORIES}</Text>
      </Box>

      <Box marginTop={1} width={barWidth}>
        <SearchBar
          width={barWidth}
          value=""
          editing
          placeholder="Search or paste a magnet link…"
          onSubmit={handleSubmit}
          onChange={(v) => { textRef.current = v; }}
        />
      </Box>
      <Box marginTop={1}>
        <Text>
          <Text color={COLOR.alt}>↵</Text>
          <Text dimColor> search </Text>
          <Text dimColor>{`  ${ICON.dot}  `}</Text>
          <Text color={COLOR.alt}>^d</Text>
          <Text dimColor> pick folder</Text>
          <Text dimColor>{`  ${ICON.dot}  `}</Text>
          <Text dimColor>empty </Text>
          <Text color={COLOR.alt}>↵</Text>
          <Text dimColor> browse</Text>
          <Text dimColor>{`  ${ICON.dot}  `}</Text>
          <Text color={COLOR.alt}>^c</Text>
          <Text dimColor> quit</Text>
        </Text>
      </Box>
    </Box>
  );
}
