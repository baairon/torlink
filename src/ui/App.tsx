import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout, useStdin } from "ink";
import { loadConfig, saveConfig, type Config, type DelugeConfig } from "../config/config";
import { sendMagnet } from "../deluge/client";
import { parseInput } from "../sources/magnet";
import { magnetFromTorrentFile } from "../sources/torrentFile";
import { readClipboard, writeClipboard } from "../util/clipboard";
import { cleanText, truncate } from "../util/format";
import {
  StoreContext,
  type CaptureMode,
  type Region,
  type Section,
  type Store,
  type View,
} from "./store";
import { Logo } from "./components/Logo";
import { Sidebar, RAIL_WIDTH } from "./components/Sidebar";
import { Rule } from "./components/Rule";
import { Footer } from "./components/Footer";
import { HelpOverlay } from "./components/HelpOverlay";
import { Results } from "./components/Results";
import { Spinner } from "./components/Spinner";
import { TabTitle } from "./components/TabTitle";
import { Splash } from "./views/Splash";
import { DelugeSettingsPrompt } from "./components/DelugeSettingsPrompt";
import { footerHints } from "./keymap";
import { COLOR, ICON } from "./theme";
import { useMouseWheel } from "./hooks/useMouseWheel";
import type { SourceId } from "../sources/types";

export function App({
  initialMagnet,
  initialTorrent,
  onQuit,
}: { initialMagnet?: string; initialTorrent?: string; onQuit?: () => void } = {}) {
  useMouseWheel();
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { stdout } = useStdout();

  const [size, setSize] = useState({
    rows: stdout?.rows ?? 24,
    cols: stdout?.columns ?? 80,
  });
  useEffect(() => {
    if (!stdout) return;
    let last = { rows: stdout.rows ?? 24, cols: stdout.columns ?? 80 };
    const onResize = (): void => {
      const next = { rows: stdout.rows ?? 24, cols: stdout.columns ?? 80 };
      if (next.rows === last.rows && next.cols === last.cols) return;
      if (next.rows < last.rows || next.cols < last.cols) {
        stdout.write("\x1b[2J\x1b[H");
      }
      last = next;
      setSize(next);
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  const rows = size.rows;
  const cols = size.cols;

  const [config, setConfigState] = useState<Config | null>(null);
  const [view, setView] = useState<View>("splash");
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<Section>("all");
  const [region, setRegion] = useState<Region>("content");
  const [captureMode, setCaptureMode] = useState<CaptureMode>("none");
  const [showHelp, setShowHelp] = useState(false);
  const [editingDeluge, setEditingDeluge] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const booting = useRef(false);

  const setConfig = useCallback((c: Config) => {
    setConfigState(c);
    void saveConfig(c);
  }, []);

  const sendToDeluge = useCallback(
    (input: { name: string; magnet: string }) => {
      const deluge = config?.deluge ?? null;
      if (!deluge) {
        setNotice("No Deluge connection set – press o to configure it.");
        return;
      }
      setNotice(`Sending to Deluge: ${truncate(cleanText(input.name), 40)}`);
      void sendMagnet(deluge, input.magnet).then((result) => {
        if (result.ok) {
          setNotice(
            result.status === "already-added"
              ? `Already in Deluge: ${truncate(cleanText(input.name), 40)}`
              : `${ICON.done} Sent to Deluge: ${truncate(cleanText(input.name), 40)}`,
          );
          return;
        }
        setNotice(result.message);
      });
    },
    [config],
  );

  useEffect(() => {
    if (booting.current) return;
    booting.current = true;
    let alive = true;
    void (async () => {
      const cfg = await loadConfig();
      if (!alive) return;
      setConfigState(cfg);
      const launch = initialMagnet
        ? parseInput(initialMagnet)
        : initialTorrent
          ? await magnetFromTorrentFile(initialTorrent)
          : null;
      if (launch) {
        if (cfg.deluge) {
          void sendMagnet(cfg.deluge, launch.magnet).then((result) => {
            if (!alive) return;
            setNotice(
              result.ok
                ? result.status === "already-added"
                  ? `Already in Deluge: ${truncate(cleanText(launch.name), 40)}`
                  : `${ICON.done} Sent to Deluge: ${truncate(cleanText(launch.name), 40)}`
                : result.message,
            );
          });
        } else {
          setNotice("No Deluge connection set – press o to configure it.");
        }
        setView("browser");
      }
    })();
    return () => {
      alive = false;
    };
  }, [initialMagnet, initialTorrent]);

  const quitAll = useCallback(() => {
    if (onQuit) onQuit();
    else exit();
  }, [onQuit, exit]);

  const closeDelugePrompt = useCallback(() => {
    setEditingDeluge(false);
  }, []);

  const setDeluge = useCallback(
    (deluge: DelugeConfig) => {
      closeDelugePrompt();
      if (!config) return;
      setConfig({ ...config, deluge });
      setNotice(`Deluge connection saved: ${truncate(deluge.url, 48)}`);
    },
    [config, setConfig, closeDelugePrompt],
  );

  const copyMagnet = useCallback((input: { name: string; magnet: string }) => {
    void (async () => {
      const ok = await writeClipboard(input.magnet);
      if (ok) {
        setNotice(`Copied magnet: ${truncate(cleanText(input.magnet), 60)}`);
        return;
      }
      setNotice(`Couldn't copy magnet for ${truncate(cleanText(input.name), 32)}.`);
    })();
  }, []);

  const submitQuery = useCallback(
    (raw: string) => {
      const q = raw.trim();
      if (q) {
        const magnet = parseInput(q);
        if (magnet) {
          sendToDeluge({ name: magnet.name, magnet: magnet.magnet });
          setView("browser");
          return;
        }
      }
      setQuery(q);
      setView("browser");
      setRegion("content");
    },
    [sendToDeluge],
  );

  const pasteFromClipboard = useCallback(async () => {
    const text = (await readClipboard()).trim();
    if (!text) {
      setNotice("Clipboard is empty.");
      return;
    }
    const found = text.match(/magnet:\?xt=urn:btih:[^\s"'<>]+/i)?.[0];
    const magnet = parseInput(found ?? text);
    if (magnet) {
      sendToDeluge({ name: magnet.name, magnet: magnet.magnet });
      setView("browser");
      return;
    }
    setNotice("No magnet link on the clipboard.");
  }, [sendToDeluge]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const compact = rows < 18;
  const showTopRule = !compact;
  const showFooter = rows >= 12;
  const chrome =
    3 +
    (showTopRule ? 1 : 0) +
    (compact ? 0 : 1) +
    (showFooter ? 1 : 0);
  const bodyH = Math.max(6, rows - 1 - chrome);
  const listRows = Math.max(4, bodyH);
  const contentWidth = Math.max(24, cols - RAIL_WIDTH - 3);
  const ruleWidth = Math.max(10, cols - 2);

  const store: Store | null = useMemo(() => {
    if (!config) return null;
    return {
      config,
      setConfig,
      view,
      setView,
      query,
      submitQuery,
      section,
      setSection,
      region: showHelp || editingDeluge ? "help" : region,
      setRegion,
      captureMode,
      setCaptureMode,
      sendToDeluge,
      copyMagnet,
      notice,
      setNotice,
      quitAll,
      listRows,
      compact,
      contentWidth,
      cols,
      rows,
    };
  }, [
    config,
    view,
    query,
    submitQuery,
    section,
    region,
    showHelp,
    editingDeluge,
    captureMode,
    sendToDeluge,
    copyMagnet,
    notice,
    listRows,
    compact,
    contentWidth,
    cols,
    rows,
    setConfig,
    quitAll,
  ]);

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        quitAll();
        return;
      }
      if (editingDeluge) return; // the prompt owns input (its own esc + enter)
      if (captureMode === "text") return;
      if (showHelp) {
        setShowHelp(false);
        return;
      }
      if (input === "?") {
        setShowHelp(true);
        return;
      }
      if (input === "o") {
        setShowHelp(false);
        setEditingDeluge(true);
        return;
      }
      if (input === "m") {
        void pasteFromClipboard();
        return;
      }
      if (key.tab) {
        setRegion(region === "sidebar" ? "content" : "sidebar");
        return;
      }
      if (key.rightArrow || input === "l") {
        if (region === "sidebar") setRegion("content");
        return;
      }
      if (key.leftArrow || input === "h") {
        if (region === "content") setRegion("sidebar");
        return;
      }
      if (key.escape) {
        if (captureMode === "esc") return;
        if (region === "content") {
          setRegion("sidebar");
          return;
        }
        setView("splash");
        return;
      }
      if (input === "q") {
        quitAll();
        return;
      }
    },
    { isActive: isRawModeSupported && view === "browser" && !!store },
  );

  if (!store) {
    return (
      <Box height={rows} justifyContent="center" alignItems="center">
        <Spinner label="Starting torlink" />
      </Box>
    );
  }

  if (view === "splash") {
    return (
      <StoreContext.Provider value={store}>
        <TabTitle />
        <Splash />
      </StoreContext.Provider>
    );
  }

  return (
    <StoreContext.Provider value={store}>
      <TabTitle />
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Logo />
          {notice ? <Text color={COLOR.good}>{notice}</Text> : null}
        </Box>
        {showTopRule ? <Rule width={ruleWidth} /> : null}

        {showHelp ? (
          <Box marginTop={1}>
            <HelpOverlay />
          </Box>
        ) : null}

        {editingDeluge ? (
          <Box marginTop={1}>
            <DelugeSettingsPrompt
              width={Math.max(24, Math.min(cols - 4, 62))}
              value={store.config.deluge}
              onSubmit={setDeluge}
              onCancel={closeDelugePrompt}
            />
          </Box>
        ) : null}

        <Box
          height={bodyH}
          marginTop={compact ? 0 : 1}
          display={showHelp || editingDeluge ? "none" : "flex"}
          overflow="hidden"
        >
          <Sidebar />
          <Box flexGrow={1} flexDirection="column">
            <Results />
          </Box>
        </Box>

        {showFooter ? (
          <Box display={showHelp || editingDeluge ? "none" : "flex"}>
            <Footer hints={footerHints(region)} />
          </Box>
        ) : null}
      </Box>
    </StoreContext.Provider>
  );
}
