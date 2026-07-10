import { Box, Text, useStdin } from "ink";
import { useSafeInput } from "../hooks/useSafeInput";
import { Logo } from "../components/Logo";
import { SearchBar } from "../components/SearchBar";
import { LOGO_WIDTH } from "../lib/logo";
import { useStore } from "../state/store";
import { sourcesByGroup } from "../../sources/registry";
import { COLOR, ICON } from "../lib/theme";

const CATEGORIES = sourcesByGroup()
  .map((g) => g.group.toLowerCase())
  .join(`  ${ICON.dot}  `);

export function Splash() {
  const { submitQuery, quitAll, cols, rows } = useStore();
  const { isRawModeSupported } = useStdin();

  useSafeInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === "c")) quitAll();
    },
    { isActive: isRawModeSupported },
  );

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
          TorZlink
        </Text>
      )}
      <Box marginTop={2}>
        <Text color={COLOR.text}>A torrent downloader forked from TorLink and designed for the terminal.</Text>
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
          onSubmit={submitQuery}
        />
      </Box>
      <Box marginTop={1}>
        <Text>
          <Text color={COLOR.alt}>↵</Text>
          <Text dimColor> search</Text>
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
