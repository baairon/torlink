import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import chalk from "chalk";
import { render } from "ink";
import type { ReactNode } from "react";

// Ink styles Text through this shared chalk instance (chalk rides in as ink's
// own dependency), and chalk mutes every code under vitest's piped stdout.
// Forcing the level keeps SGR in captured frames, which rawFrame() relies on
// to see the TextField's inverse cursor.
chalk.level = 3;
import type { Config } from "../config/config";
import type { DownloadQueue } from "../download/queue";
import type { QueueItem, SeedItem } from "../download/types";
import type { HistoryItem } from "../download/history";
import { RAIL_WIDTH } from "./components/Sidebar";
import type { Store } from "./store";

export const TEST_COLS = 80;
export const TEST_CONTENT_WIDTH = Math.max(24, TEST_COLS - RAIL_WIDTH - 3);

export const KEY = {
  enter: "\r",
  esc: "\u001b",
  ctrlU: "\u0015",
} as const;

// SGR/CSI sequences only. util/format's stripControl drops the ESC byte but
// leaves the sequence text behind, so it cannot clean frames for assertions.
export function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}

export interface RenderedUI {
  /** Latest rendered frame, ANSI-stripped. */
  frame: () => string;
  /** Latest rendered frame with escape codes intact (inverse cursor = ESC[7m). */
  rawFrame: () => string;
  /** Feed raw bytes to the app as if typed. */
  press: (bytes: string) => void;
  unmount: () => void;
}

/**
 * Renders an Ink tree for tests. Input goes through a real PassThrough stream
 * because Ink 7 consumes stdin via 'readable' + stdin.read(): bytes emitted on
 * a plain EventEmitter stub (ink-testing-library's stdin) never reach its
 * parser. Raw mode is gated on stdin.isTTY plus a callable setRawMode.
 */
export function renderUI(node: ReactNode, opts: { cols?: number; rows?: number } = {}): RenderedUI {
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (v: boolean) => void;
    ref: () => void;
    unref: () => void;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  // Socket-only members Ink calls when input hooks mount; streams lack them.
  stdin.ref = () => {};
  stdin.unref = () => {};

  const writes: string[] = [];
  const stdout = Object.assign(new EventEmitter(), {
    columns: opts.cols ?? TEST_COLS,
    rows: opts.rows ?? 24,
    write(chunk: unknown): boolean {
      writes.push(String(chunk));
      return true;
    },
  });

  const instance = render(node, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    // debug makes every render land as one full standalone frame in `writes`,
    // instead of incremental repaints that only carry changed lines.
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  // A fatal render error makes Ink self-unmount after an empty frame; without
  // this, tests would only ever see that blank frame, never the cause.
  let fatal: unknown = null;
  instance.waitUntilExit().catch((e: unknown) => {
    fatal = e;
  });
  const guard = (): void => {
    if (fatal) throw fatal;
  };

  return {
    frame: () => {
      guard();
      return stripAnsi(writes.at(-1) ?? "");
    },
    rawFrame: () => writes.at(-1) ?? "",
    press: (bytes: string) => void stdin.write(bytes),
    unmount: () => instance.unmount(),
  };
}

// Functional enough for panel tests: history mutations emit "update" so the
// useQueue* hooks refresh, everything else is a stub.
export function fakeQueue(
  items: QueueItem[] = [],
  history: HistoryItem[] = [],
  seeds: SeedItem[] = [],
): DownloadQueue {
  const em = new EventEmitter();
  let hist = [...history];
  const stub = {
    getItems: () => items,
    getHistory: () => hist,
    getSeeds: () => seeds,
    getSeed: (id: string) => seeds.find((s) => s.id === id),
    activeCount: items.filter((i) => i.status === "downloading").length,
    seedingCount: 0,
    on: (ev: string, cb: () => void) => (em.on(ev, cb), stub),
    off: (ev: string, cb: () => void) => (em.off(ev, cb), stub),
    removeHistory: (id: string): void => {
      hist = hist.filter((h) => h.id !== id);
      em.emit("update");
    },
    clearHistory: (): void => {
      hist = [];
      em.emit("update");
    },
    cancel: (): void => {},
    togglePause: (): void => {},
    retryFailed: (): void => {},
  };
  return stub as unknown as DownloadQueue;
}

// Mirrors makeStore in scripts/render-previews-impl.tsx, which cannot be
// imported here: that module generates previews at import time. Typing the
// literal as Store keeps the same drift guard: a new Store field fails compile.
export function makeTestStore(overrides: Partial<Store> = {}): Store {
  const noop = (): void => {};
  return {
    config: { downloadDir: "~/Downloads/torlink" } as Config,
    setConfig: noop,
    queue: fakeQueue(),
    view: "browser",
    setView: noop,
    query: "",
    submitQuery: noop,
    section: "all",
    setSection: noop,
    region: "content",
    setRegion: noop,
    captureMode: "none",
    setCaptureMode: noop,
    downloadFocus: null,
    setDownloadFocus: noop,
    seedFocus: null,
    setSeedFocus: noop,
    startDownload: noop,
    requestDownloadTo: noop,
    copyMagnet: noop,
    openDownloadFolder: noop,
    exportTorrent: noop,
    playTorrent: noop,
    notice: null,
    setNotice: noop,
    quitAll: noop,
    listRows: 14,
    compact: false,
    contentWidth: TEST_CONTENT_WIDTH,
    cols: TEST_COLS,
    rows: 24,
    ...overrides,
  };
}
