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
import { applyNetworkBinding } from "../download/network";
import { logCrash } from "../util/crashlog";
import { parseInput } from "../sources/magnet";
import { magnetFromTorrentFile } from "../sources/torrentFile";
import { resolveTorrentPath } from "../sources/torrentPath";
import { readClipboard, writeClipboard } from "../util/clipboard";
import { openFolder } from "../util/openFolder";
import { startWebServer, stopWebServer } from "../server";
import { AutoDownloader } from "../daemon/autodownload";
import { cleanText, formatBytes, truncate } from "../util/format";
import {
  StoreContext,
  type CaptureMode,
  type DownloadFocus,
  type Region,
  type ResultFocus,
  type Section,
  type SeedFocus,
  type Store,
  type View,
  useStore,
} from "./store";
import { Logo } from "./components/Logo";
import { Sidebar, RAIL_WIDTH } from "./components/Sidebar";
import { PeerInspector } from "./components/PeerInspector";
import { MetadataInspector } from "./components/MetadataInspector";
import { Rule } from "./components/Rule";
import { Footer } from "./components/Footer";
import { HelpOverlay } from "./components/HelpOverlay";
import { Results } from "./components/Results";
import { Downloads } from "./components/Downloads";
import { Seeding } from "./components/Seeding";
import { Completed } from "./components/Completed";
import { Spinner } from "./components/Spinner";
import { TabTitle } from "./components/TabTitle";
import { Files } from "./components/Files";
import { Splash } from "./views/Splash";
import { FolderPrompt } from "./components/FolderPrompt";
import { TrackersPrompt } from "./components/TrackersPrompt";
import { NetworkPrompt } from "./components/NetworkPrompt";
import { ConfirmPrompt } from "./components/ConfirmPrompt";
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
  const [autoDownloader, setAutoDownloader] = useState<AutoDownloader | null>(null);
  const [view, setView] = useState<View>("splash");
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<Section>("all");
  const [region, setRegion] = useState<Region>("content");
  const [captureMode, setCaptureMode] = useState<CaptureMode>("none");
  const [downloadFocus, setDownloadFocus] = useState<DownloadFocus | null>(null);
  const [seedFocus, setSeedFocus] = useState<SeedFocus | null>(null);
  const [resultFocus, setResultFocus] = useState<ResultFocus | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [editingFolder, setEditingFolder] = useState(false);
  const [editingTrackers, setEditingTrackers] = useState(false);
  const [editingNetwork, setEditingNetwork] = useState(false);
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
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inspectingId, setInspectingIdState] = useState<string | null>(null);
  const [inspectingMagnet, setInspectingMagnet] = useState<string | null>(null);
  const [inspectingPeersId, setInspectingPeersId] = useState<string | null>(null);
  const [inspectingMetaId, setInspectingMetaIdState] = useState<string | null>(null);
  const [inspectingMetaMagnet, setInspectingMetaMagnet] = useState<string | null>(null);
  const [inspectFocusSelected, setInspectFocusSelected] = useState<boolean>(true);  
  const setInspectingId = useCallback((id: string | null, magnet?: string) => {
    setInspectingIdState(id);
    setInspectingMagnet(magnet ?? null);
  }, []);
  const setInspectingMetaId = useCallback((id: string | null, magnet?: string) => {
    setInspectingMetaIdState(id);
    setInspectingMetaMagnet(magnet ?? null);
  }, []);
  
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false);
  const booting = useRef(false);

  useEffect(() => {
    if (booting.current) return;
    booting.current = true;
    let alive = true;
    void (async () => {
      const cfg = await loadConfig();
      applyNetworkBinding(cfg);
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
      
      let ad: AutoDownloader | null = null;
      if (cfg.autoDownloads && cfg.autoDownloads.length > 0) {
        ad = new AutoDownloader(q, cfg, (msg) => {
          if (alive) setNotice(msg.replace("AutoDownloader: ", ""));
        });
        ad.start();
        setAutoDownloader(ad);
      }
      
      if (safeBoot) {
        setRecovered(true);
        setNotice("Recovered from a crashed start · downloads paused");
      }
      const launch = initialMagnet
        ? parseInput(initialMagnet)
        : initialTorrent
          ? await magnetFromTorrentFile(resolveTorrentPath(initialTorrent) ?? initialTorrent)
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

  useEffect(() => {
    setInspectingId(null);
    setInspectingPeersId(null);
  }, [section]);


  useEffect(
    () => () => {
      autoDownloader?.stop();
      queue?.suspend();
    },
    [queue, autoDownloader],
  );

  const quitAll = useCallback(() => {
    // Flush all state synchronously up front so nothing is lost to the hard
    // exit; the unmount effect still runs suspend() for the engine teardown.
    autoDownloader?.stop();
    queue?.persistSync();
    if (onQuit) onQuit();
    else exit();
  }, [queue, autoDownloader, onQuit, exit]);

  const setConfig = useCallback(
    (c: Config) => {
      setConfigState(c);
      applyNetworkBinding(c);
      queue?.setTrackers(c.trackers);
      if (autoDownloader) {
        autoDownloader.setConfig(c);
      }
      void saveConfig(c);
    },
    [queue, autoDownloader],
  );

  useEffect(() => {
    if (!config) return;
    if (config.webServerEnabled && config.downloadDir) {
      startWebServer(config.downloadDir, config.webServerPort)
        .catch((e) => setNotice(`Web server failed: ${e.message}`));
    } else {
      stopWebServer();
    }
  }, [config?.webServerEnabled, config?.webServerPort, config?.downloadDir]);

  const toggleThrottle = useCallback(() => {
    if (!config) return;
    setConfig({ ...config, throttleEnabled: !config.throttleEnabled });
  }, [config, setConfig]);

  useEffect(() => {
    if (queue && config) {
      queue.setThrottle(config.throttleEnabled, config.throttleDownloadLimit, config.throttleUploadLimit);
    }
  }, [queue, config?.throttleEnabled, config?.throttleDownloadLimit, config?.throttleUploadLimit]);

  const closeFolderPrompt = useCallback(() => {
    setEditingFolder(false);
  }, []);

  const closeTrackersPrompt = useCallback(() => {
    setEditingTrackers(false);
  }, []);

  const closeNetworkPrompt = useCallback(() => {
    setEditingNetwork(false);
  }, []);

  const setBindAddress = useCallback(
    (address: string | null) => {
      closeNetworkPrompt();
      if (!config) return;
      if (address === config.bindAddress) {
        setNotice("Network binding unchanged.");
        return;
      }
      setConfig({ ...config, bindAddress: address });
      setNotice(address ? `Network bound to: ${address}` : "Network binding cleared.");
    },
    [config, setConfig, closeNetworkPrompt]
  );

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

  const requestConfirm = useCallback((message: string, onConfirm: () => void) => {
    setPendingConfirm({ message, onConfirm });
  }, []);

  const closeConfirmPrompt = useCallback(() => {
    setPendingConfirm(null);
  }, []);

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

  const toggleFileSelection = useCallback(
    (id: string, path: string, selected: boolean) => {
      queue?.toggleFileSelection(id, path, selected);
    },
    [queue],
  );

  const fetchAndExportTorrent = useCallback(
    (input: { id: string; name: string; magnet: string }) => {
      if (!queue || !config) return;
      setNotice("Fetching torrent metadata…");
      void (async () => {
        const file = await queue.fetchAndExportTorrent(input, config.downloadDir);
        if (file) {
          setNotice(`Exported torrent file: ${truncate(file, 48)}`);
          return;
        }
        setNotice(`Couldn't export torrent file for ${truncate(cleanText(input.name), 32)}.`);
      })();
    },
    [queue, config],
  );

  // A .torrent dragged onto the terminal lands in the search field as a path.
  // Read it, hand the queue the magnet built from its metadata, and say so when
  // it can't be read rather than quietly searching for the path text.
  const startFromTorrentFile = useCallback(
    (file: string) => {
      setNotice(`Reading torrent file: ${truncate(file, 48)}`);
      void (async () => {
        const parsed = await magnetFromTorrentFile(file);
        if (!parsed) {
          setNotice(`Couldn't read a torrent from ${truncate(file, 48)}.`);
          return;
        }
        startDownload({ id: parsed.infoHash, name: parsed.name, magnet: parsed.magnet });
      })();
      setView("browser");
    },
    [startDownload],
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
        const file = resolveTorrentPath(q);
        if (file) {
          startFromTorrentFile(file);
          return;
        }
      }
      setQuery(q);
      setView("browser");
      if (section === "downloads") setSection("all");
      setRegion("content");
    },
    [section, startDownload, startFromTorrentFile],
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
    // Copying a file in a file manager puts its path on the clipboard, so paste
    // takes one too — same handling as a drag onto the search field.
    const file = resolveTorrentPath(text);
    if (file) {
      startFromTorrentFile(file);
      return;
    }
    setNotice("No magnet link or .torrent file on the clipboard.");
  }, [startDownload, startFromTorrentFile]);

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
    (showFooter ? 1 : 0) +
    (pendingConfirm ? 2 : 0);
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
      region: showHelp || editingFolder || editingTrackers || editingNetwork || pendingDownload || pendingConfirm ? "help" : region,
      setRegion,
      captureMode,
      setCaptureMode,
      downloadFocus,
      setDownloadFocus,
      seedFocus,
      setSeedFocus,
      resultFocus,
      setResultFocus,
      startDownload,
      requestDownloadTo,
      copyMagnet,
      openDownloadFolder,
      requestConfirm,
      exportTorrent,
      fetchAndExportTorrent,
      notice,
      setNotice,
      inspectingId,
      inspectingMagnet,
      setInspectingId,
      inspectingPeersId,
      setInspectingPeersId,
      inspectingMetaId,
      inspectingMetaMagnet,
      setInspectingMetaId,
      inspectFocusSelected,
      setInspectFocusSelected,
      toggleFileSelection,
      toggleThrottle,
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
    editingNetwork,
    pendingDownload,
    captureMode,
    downloadFocus,
    seedFocus,
    resultFocus,
    startDownload,
    requestDownloadTo,
    copyMagnet,
    openDownloadFolder,
    exportTorrent,
    fetchAndExportTorrent,
    notice,
    inspectingId,
    inspectingMagnet,
    inspectingPeersId,
    inspectingMetaId,
    inspectingMetaMagnet,
    toggleFileSelection,
    toggleThrottle,
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
      if (editingFolder || editingTrackers || editingNetwork || pendingDownload || pendingConfirm) return; // the prompt owns input (its own esc + enter)
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
      if (input === "W") {
        if (!config) return;
        const enabled = !config.webServerEnabled;
        const c = { ...config, webServerEnabled: enabled };
        setConfig(c);
        void saveConfig(c);
        return;
      }
      if (input === "t") {
        setShowHelp(false);
        setEditingTrackers(true);
        return;
      }
      if (input === "n") {
        setShowHelp(false);
        setEditingNetwork(true);
        return;
      }
      if (input === "m") {
        void pasteFromClipboard();
        return;
      }
      if (input === "w") {
        if (inspectingPeersId) setInspectingPeersId(null);
        return;
      }
      if (key.tab) {
        if (inspectingId) setInspectingId(null);
        if (inspectingPeersId) setInspectingPeersId(null);
        setRegion(region === "sidebar" ? "content" : "sidebar");
        return;
      }
      if (key.rightArrow || input === "l") {
        if (region === "sidebar") setRegion("content");
        return;
      }
      if (key.leftArrow || input === "h") {
        if (inspectingId) {
          setInspectingId(null);
          return;
        }
        if (inspectingPeersId) {
          setInspectingPeersId(null);
          return;
        }
        if (region === "content") setRegion("sidebar");
        return;
      }
      if (key.escape) {
        if (captureMode === "esc") return;
        if (inspectingId) {
          setInspectingId(null);
          return;
        }
        if (inspectingPeersId) {
          setInspectingPeersId(null);
          return;
        }
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
      if (input === "b") {
        store?.toggleThrottle();
        return;
      }
    },
    { isActive: isRawModeSupported && view === "browser" && !!store },
  );

  if (!store) {
    return (
      <Box height={rows} justifyContent="center" alignItems="center">
        <Spinner label="Starting Klink" />
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
        <Box flexDirection="column" justifyContent="space-between">
          <Box justifyContent="space-between">
            {/* The wordmark never shrinks: without these constraints a long notice
                squeezes the logo box and wraps its own text through the art. */}
            <Box flexShrink={0} gap={1} alignItems="center">
              <Logo />
              {store.config.throttleEnabled ? <Text dimColor>🐢 Throttled</Text> : null}
              {store.config.webServerEnabled ? <Text dimColor>🌐 http://localhost:{store.config.webServerPort}</Text> : null}
            </Box>
            {notice ? (
              <Box flexShrink={1} minWidth={0} marginLeft={2}>
                <Text color={COLOR.good} wrap="truncate-end">
                  {notice}
                </Text>
              </Box>
            ) : null}
          </Box>
          {pendingConfirm ? (
            <Box marginTop={1}>
              <ConfirmPrompt
                message={pendingConfirm.message}
                onConfirm={() => {
                  pendingConfirm.onConfirm();
                  setPendingConfirm(null);
                }}
                onCancel={closeConfirmPrompt}
              />
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

        {editingNetwork ? (
          <Box marginTop={1}>
            <NetworkPrompt
              width={Math.max(24, Math.min(cols - 4, 62))}
              value={store.config.bindAddress}
              onSubmit={setBindAddress}
              onCancel={closeNetworkPrompt}
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
            {inspectingId ? (
              <Files />
            ) : inspectingPeersId ? (
              <PeerInspector id={inspectingPeersId} />
            ) : section === "downloads" ? (
              <Downloads />
            ) : section === "seeding" ? (
              <Seeding />
            ) : section === "completed" ? (
              <Completed />
            ) : (
              <Results />
            )}
          </Box>
        </Box>

        {showFooter ? (
          <Box display={showHelp || editingFolder || editingTrackers || pendingDownload ? "none" : "flex"}>
            <Footer hints={footerHints(region, section, store.config.throttleEnabled, inspectingPeersId, downloadFocus, seedFocus, !!inspectingId, inspectFocusSelected, resultFocus)} />
          </Box>
        ) : null}
      </Box>
      <MetadataInspector />
    </StoreContext.Provider>
  );
}
