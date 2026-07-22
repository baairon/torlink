import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout, useStdin } from "ink";
import { promises as fs } from "node:fs";
import { loadConfig, saveConfig, type Config } from "../config/config";
import { normalizeDownloadDir } from "../config/folder";
import { DownloadQueue } from "../download/queue";
import { loadQueue, loadSeeds } from "../download/persist";
import { loadHistory } from "../download/history";
import { reconcileQueue } from "../download/reconcile";
import {
  BOOT_SETTLE_MS,
  armBootMarker,
  disarmBootMarker,
  wasBootInterrupted,
} from "../download/bootguard";
import { logCrash } from "../util/crashlog";
import { parseInput } from "../sources/magnet";
import { magnetFromTorrentFile } from "../sources/torrentFile";
import { readClipboard, writeClipboard } from "../util/clipboard";
import { openFolder } from "../util/openFolder";
import { cleanText, formatBytes, truncate } from "../util/format";
import {
  StoreContext,
  type CaptureMode,
  type DownloadFocus,
  type Region,
  type Section,
  type SeedFocus,
  type Store,
  type View,
} from "./store";
import { Logo } from "./components/Logo";
import { Sidebar, RAIL_WIDTH } from "./components/Sidebar";
import { Rule } from "./components/Rule";
import { Footer } from "./components/Footer";
import { HelpOverlay } from "./components/HelpOverlay";
import { Results } from "./components/Results";
import { Downloads } from "./components/Downloads";
import { Seeding } from "./components/Seeding";
import { Spinner } from "./components/Spinner";
import { TabTitle } from "./components/TabTitle";
import { Splash } from "./views/Splash";
import { FolderPrompt } from "./components/FolderPrompt";
import { TrackersPrompt } from "./components/TrackersPrompt";
import { footerHints } from "./keymap";
import { COLOR, ICON } from "./theme";
import { useMouseWheel } from "./hooks/useMouseWheel";
import { VERSION } from "../version";
import { fetchLatestVersion, isNewer } from "../update/version";
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

  const [queue, setQueue] = useState<DownloadQueue | null>(null);
  const [config, setConfigState] = useState<Config | null>(null);
  const [view, setView] = useState<View>("splash");
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<Section>("all");
  const [region, setRegion] = useState<Region>("content");
  const [captureMode, setCaptureMode] = useState<CaptureMode>("none");
  const [downloadFocus, setDownloadFocus] = useState<DownloadFocus | null>(null);
  const [seedFocus, setSeedFocus] = useState<SeedFocus | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [editingFolder, setEditingFolder] = useState(false);
  const [editingTrackers, setEditingTrackers] = useState(false);
  // A result waiting on the "download to" prompt (D); null when the prompt is
  // closed. lastDownloadToDir pre-fills the next prompt so queueing a batch
  // into the same alternate folder only costs one typed path per session.
  const [pendingDownload, setPendingDownload] = useState<{
    id: string;
    name: string;
    magnet: string;
    source?: SourceId;
    sizeBytes?: number;
  } | null>(null);
  const [lastDownloadToDir, setLastDownloadToDir] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false);
  const booting = useRef(false);

  useEffect(() => {
    if (booting.current) return;
    booting.current = true;
    let alive = true;
    void (async () => {
      const cfg = await loadConfig();
      const q = new DownloadQueue();
      q.setTrackers(cfg.trackers);
      // Crash-boot breaker: a marker left behind by the previous boot means it
      // died mid-restore, so this one restores everything paused with the
      // engine cold (safe mode) instead of walking into the same explosion.
      const safeBoot = wasBootInterrupted();
      armBootMarker();
      // One fail-safe around the whole restore, holding a single invariant: the
      // app always reaches a usable screen. Nothing below throws today (every
      // loader falls back to empty state and the engine calls are guarded), but
      // a future one that did would otherwise strand the boot on the loading
      // spinner, which is the worst failure this app has.
      try {
        q.restore(reconcileQueue(await loadQueue()), { safe: safeBoot });
        q.restoreHistory(await loadHistory());
        q.restoreSeeds(await loadSeeds(), { safe: safeBoot });
      } catch (e) {
        logCrash("boot-restore", e);
      }
      setTimeout(disarmBootMarker, BOOT_SETTLE_MS).unref();
      if (!alive) {
        q.suspend();
        return;
      }
      setConfigState(cfg);
      setQueue(q);
      if (safeBoot) {
        setRecovered(true);
        setNotice("Recovered from a crashed start · downloads paused");
      }
      const launch = initialMagnet
        ? parseInput(initialMagnet)
        : initialTorrent
          ? await magnetFromTorrentFile(initialTorrent)
          : null;
      if (launch) {
        await fs.mkdir(cfg.downloadDir, { recursive: true }).catch(() => {});
        q.add(
          { id: launch.infoHash, name: launch.name, magnet: launch.magnet },
          cfg.downloadDir,
        );
        setView("browser");
        setSection("downloads");
        setRegion("content");
      }
    })();
    return () => {
      alive = false;
    };
  }, [initialMagnet, initialTorrent]);

  // Best-effort, once per launch, off the hot path: if a newer release exists,
  // surface a quiet banner. Any failure (offline, opt-out) just leaves it hidden.
  useEffect(() => {
    if (process.env.TORLINK_NO_UPDATE_CHECK) return;
    let alive = true;
    void (async () => {
      const latest = await fetchLatestVersion();
      if (alive && latest && isNewer(VERSION, latest)) setUpdateVersion(latest);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!queue) return;
    const onCompleted = (name: string): void =>
      setNotice(`${ICON.done} ${truncate(cleanText(name), 40)}`);
    queue.on("completed", onCompleted);
    return () => {
      queue.off("completed", onCompleted);
    };
  }, [queue]);

  useEffect(
    () => () => {
      queue?.suspend();
    },
    [queue],
  );

  const quitAll = useCallback(() => {
    // Flush all state synchronously up front so nothing is lost to the hard
    // exit; the unmount effect still runs suspend() for the engine teardown.
    queue?.persistSync();
    if (onQuit) onQuit();
    else exit();
  }, [queue, onQuit, exit]);

  const setConfig = useCallback(
    (c: Config) => {
      setConfigState(c);
      queue?.setTrackers(c.trackers);
      void saveConfig(c);
    },
    [queue],
  );

  const closeFolderPrompt = useCallback(() => {
    setEditingFolder(false);
  }, []);

  const closeTrackersPrompt = useCallback(() => {
    setEditingTrackers(false);
  }, []);

  const setTrackers = useCallback(
    (list: string[]) => {
      closeTrackersPrompt();
      if (!config) return;
      const same =
        list.length === config.trackers.length &&
        list.every((t, i) => t === config.trackers[i]);
      if (same) {
        setNotice("Trackers unchanged.");
        return;
      }
      setConfig({ ...config, trackers: list });
      setNotice(list.length === 0 ? "Cleared extra trackers." : `Saved ${list.length} tracker${list.length === 1 ? "" : "s"}.`);
    },
    [config, setConfig, closeTrackersPrompt],
  );

  const setDownloadDir = useCallback(
    (raw: string) => {
      closeFolderPrompt();
      const dir = normalizeDownloadDir(raw);
      if (!config || !dir || dir === config.downloadDir) {
        if (config && dir && dir === config.downloadDir) setNotice("Download folder unchanged.");
        return;
      }
      void (async () => {
        try {
          await fs.mkdir(dir, { recursive: true });
        } catch {
          setNotice(`Couldn't use folder: ${truncate(dir, 48)}`);
          return;
        }
        setConfig({ ...config, downloadDir: dir });
        setNotice(`Download folder: ${truncate(dir, 48)}`);
      })();
    },
    [config, setConfig, closeFolderPrompt],
  );

  const startDownload = useCallback(
    (input: {
      id: string;
      name: string;
      magnet: string;
      source?: SourceId;
      sizeBytes?: number;
    }) => {
      if (!config || !queue) return;
      void fs.mkdir(config.downloadDir, { recursive: true }).catch(() => {});
      queue.add(input, config.downloadDir);
      setNotice(`Added: ${truncate(cleanText(input.name), 40)}`);
      setSection("downloads");
      setRegion("content");
    },
    [config, queue],
  );

  const requestDownloadTo = useCallback(
    (input: {
      id: string;
      name: string;
      magnet: string;
      source?: SourceId;
      sizeBytes?: number;
    }) => {
      setPendingDownload(input);
    },
    [],
  );

  const closeDownloadToPrompt = useCallback(() => {
    setPendingDownload(null);
  }, []);

  const startDownloadTo = useCallback(
    (raw: string) => {
      const input = pendingDownload;
      setPendingDownload(null);
      const dir = normalizeDownloadDir(raw);
      if (!queue || !input || !dir) return;
      // add() ignores the dir for anything already active, so don't claim a
      // folder that won't be used. Failed items fall through: a re-add with a
      // fresh dir is exactly how a bad-disk download gets redirected.
      const existing = queue.getItems().find((it) => it.id === input.id);
      if (existing && existing.status !== "failed") {
        setNotice(`Already in queue: ${truncate(cleanText(input.name), 40)}`);
        return;
      }
      void (async () => {
        try {
          await fs.mkdir(dir, { recursive: true });
        } catch {
          setNotice(`Couldn't use folder: ${truncate(dir, 48)}`);
          return;
        }
        setLastDownloadToDir(dir);
        queue.add(input, dir);
        setNotice(`Added: ${truncate(cleanText(input.name), 28)} → ${truncate(dir, 36)}`);
        setSection("downloads");
        setRegion("content");
      })();
    },
    [queue, pendingDownload],
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

  const openDownloadFolder = useCallback((dir: string) => {
    void (async () => {
      const ok = await openFolder(dir);
      if (ok) {
        setNotice(`Opened: ${truncate(dir, 48)}`);
        return;
      }
      setNotice(`Couldn't open folder: ${truncate(dir, 48)}`);
    })();
  }, []);

  const exportTorrent = useCallback(
    (input: { id: string; name: string }) => {
      if (!queue) return;
      void (async () => {
        const file = await queue.exportTorrentFile(input.id);
        if (file) {
          setNotice(`Exported torrent file: ${truncate(file, 48)}`);
          return;
        }
        setNotice(`No torrent file yet for ${truncate(cleanText(input.name), 32)}.`);
      })();
    },
    [queue],
  );

  const submitQuery = useCallback(
    (raw: string) => {
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
      setQuery(q);
      setView("browser");
      if (section === "downloads") setSection("all");
      setRegion("content");
    },
    [section, startDownload],
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
      startDownload({ id: magnet.infoHash, name: magnet.name, magnet: magnet.magnet });
      setView("browser");
      return;
    }
    setNotice("No magnet link on the clipboard.");
  }, [startDownload]);

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
    if (!queue || !config) return null;
    return {
      config,
      setConfig,
      queue,
      view,
      setView,
      query,
      submitQuery,
      section,
      setSection,
      region: showHelp || editingFolder || editingTrackers || pendingDownload ? "help" : region,
      setRegion,
      captureMode,
      setCaptureMode,
      downloadFocus,
      setDownloadFocus,
      seedFocus,
      setSeedFocus,
      startDownload,
      requestDownloadTo,
      copyMagnet,
      openDownloadFolder,
      exportTorrent,
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
    queue,
    config,
    view,
    query,
    submitQuery,
    section,
    region,
    showHelp,
    editingFolder,
    editingTrackers,
    pendingDownload,
    captureMode,
    downloadFocus,
    seedFocus,
    startDownload,
    requestDownloadTo,
    copyMagnet,
    openDownloadFolder,
    exportTorrent,
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
      if (editingFolder || editingTrackers || pendingDownload) return; // the prompt owns input (its own esc + enter)
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
        setEditingFolder(true);
        return;
      }
      if (input === "t") {
        setShowHelp(false);
        setEditingTrackers(true);
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
        <Splash updateVersion={updateVersion} recovered={recovered} />
      </StoreContext.Provider>
    );
  }

  return (
    <StoreContext.Provider value={store}>
      <TabTitle />
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          {/* The wordmark never shrinks: without these constraints a long notice
              squeezes the logo box and wraps its own text through the art. */}
          <Box flexShrink={0}>
            <Logo />
          </Box>
          {notice ? (
            <Box flexShrink={1} minWidth={0} marginLeft={2}>
              <Text color={COLOR.good} wrap="truncate-end">
                {notice}
              </Text>
            </Box>
          ) : null}
        </Box>
        {showTopRule ? <Rule width={ruleWidth} /> : null}

        {showHelp ? (
          <Box marginTop={1}>
            <HelpOverlay />
          </Box>
        ) : null}

        {editingFolder ? (
          <Box marginTop={1}>
            <FolderPrompt
              width={Math.max(24, Math.min(cols - 4, 62))}
              value={store.config.downloadDir}
              onSubmit={setDownloadDir}
              onCancel={closeFolderPrompt}
            />
          </Box>
        ) : null}

        {editingTrackers ? (
          <Box marginTop={1}>
            <TrackersPrompt
              width={Math.max(24, Math.min(cols - 4, 78))}
              value={store.config.trackers}
              onSubmit={setTrackers}
              onCancel={closeTrackersPrompt}
            />
          </Box>
        ) : null}

        {pendingDownload ? (
          <Box marginTop={1}>
            <FolderPrompt
              title="download to"
              width={Math.max(24, Math.min(cols - 4, 62))}
              subject={
                pendingDownload.sizeBytes
                  ? `${cleanText(pendingDownload.name)}  ${ICON.dot}  ${formatBytes(pendingDownload.sizeBytes)}`
                  : cleanText(pendingDownload.name)
              }
              submitLabel="download"
              value={lastDownloadToDir ?? store.config.downloadDir}
              onSubmit={startDownloadTo}
              onCancel={closeDownloadToPrompt}
            />
          </Box>
        ) : null}

        <Box
          height={bodyH}
          marginTop={compact ? 0 : 1}
          display={showHelp || editingFolder || editingTrackers || pendingDownload ? "none" : "flex"}
          overflow="hidden"
        >
          <Sidebar />
          <Box flexGrow={1} flexDirection="column">
            {section === "downloads" ? (
              <Downloads />
            ) : section === "seeding" ? (
              <Seeding />
            ) : (
              <Results />
            )}
          </Box>
        </Box>

        {showFooter ? (
          <Box display={showHelp || editingFolder || editingTrackers || pendingDownload ? "none" : "flex"}>
            <Footer hints={footerHints(region, section, downloadFocus, seedFocus)} />
          </Box>
        ) : null}
      </Box>
    </StoreContext.Provider>
  );
}
