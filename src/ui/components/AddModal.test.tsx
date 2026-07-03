import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "ink-testing-library";
import { AddModal } from "./AddModal";
import { StoreContext, type Store } from "../store";
import { formatBytes } from "../../util/format";
import type { DownloadQueue } from "../../download/queue";
import type { FileInfo } from "../../download/engine";
import type { TorrentResult } from "../../sources/types";

const ENTER = "\r";
const TAB = "\t";
const ESC = "\x1b";
const DOWN = "\x1b[B";
const SPACE = " ";

// Ink processes keypresses through the `scheduler` package rather than
// flushing the resulting state synchronously, and the modal's mount effect
// (queue.prepare) is a passive effect too. Tests yield a tick between an
// input/mount and whatever depends on its result (a re-render, a follow-up
// keystroke whose handling depends on updated state, etc).
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// A lone ESC byte is ambiguous (it may be the start of a multi-byte escape
// sequence), so Ink's input parser holds it for `pendingInputFlushDelayMilliseconds`
// (20ms) before treating it as a standalone Escape keypress. A plain tick()
// isn't enough here; wait past that window instead.
const awaitEscapeFlush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 25));

const result: TorrentResult = {
  infoHash: "deadbeef",
  name: "Some Movie",
  sizeBytes: 1000,
  seeders: 5,
  leechers: 1,
  source: "yts",
  magnet: "magnet:?xt=urn:btih:deadbeef",
};

const FAKE_FILES: FileInfo[] = [
  { name: "a", path: "a", length: 100 },
  { name: "b", path: "b", length: 200 },
];

interface StubQueue {
  prepare: (
    input: unknown,
    dir: string,
    handlers: { onFiles: (f: FileInfo[]) => void },
  ) => void;
  cancelPrepare: ReturnType<typeof vi.fn>;
  commitPrepare: ReturnType<typeof vi.fn>;
}

function makeQueue(files: FileInfo[] = FAKE_FILES): StubQueue {
  return {
    prepare: (_input, _dir, handlers) => {
      handlers.onFiles(files);
    },
    cancelPrepare: vi.fn(),
    commitPrepare: vi.fn(),
  };
}

const store = { listRows: 14 } as unknown as Store;

function renderModal(opts: { queue?: StubQueue; recents?: string[]; defaultDir?: string } = {}) {
  const queue = opts.queue ?? makeQueue();
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <StoreContext.Provider value={store}>
      <AddModal
        result={result}
        defaultDir={opts.defaultDir ?? "/dl"}
        recents={opts.recents ?? ["/games"]}
        queue={queue as unknown as DownloadQueue}
        onCommit={onCommit}
        onCancel={onCancel}
        width={60}
      />
    </StoreContext.Provider>,
  );
  return { ...utils, queue, onCommit, onCancel };
}

afterEach(() => {
  cleanup();
});

describe("AddModal", () => {
  it("loads the prepared file list on mount", async () => {
    const { lastFrame } = renderModal();
    await tick();
    const frame = lastFrame() ?? "";
    const rows = frame.split("\n").filter((line) => line.includes("[x]") || line.includes("[ ]"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("[x]");
    expect(rows[0]).toContain(formatBytes(100));
    expect(rows[1]).toContain("[x]");
    expect(rows[1]).toContain(formatBytes(200));
  });

  it("Enter on the path pane commits the (typed) default dir with nothing deselected", async () => {
    const { stdin, onCommit } = renderModal();
    stdin.write(ENTER);
    await tick();
    expect(onCommit).toHaveBeenCalledWith("/dl", []);
  });

  it("Tab -> Files pane -> space deselects a file, reported on commit", async () => {
    const { stdin, onCommit } = renderModal();
    await tick(); // let the file list load so FileSelect mounts
    stdin.write(TAB);
    await tick(); // focus -> files, FileSelect's useInput becomes active
    stdin.write(SPACE); // deselect index 0
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(onCommit).toHaveBeenCalledWith("/dl", [0]);
  });

  it("blocks the commit and shows a notice when every file is deselected", async () => {
    const { stdin, onCommit, lastFrame } = renderModal();
    await tick();
    stdin.write(TAB);
    await tick();
    stdin.write(SPACE); // deselect index 0
    await tick();
    stdin.write(DOWN); // move to index 1
    await tick();
    stdin.write(SPACE); // deselect index 1 - none left
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(onCommit).not.toHaveBeenCalled();
    expect(lastFrame() ?? "").toContain("Select at least one file.");
  });

  it("Esc cancels", async () => {
    const { stdin, onCancel } = renderModal();
    stdin.write(ESC);
    await awaitEscapeFlush();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels the prepared probe on unmount without a commit", async () => {
    const { unmount, queue } = renderModal();
    await tick();
    unmount();
    expect(queue.cancelPrepare).toHaveBeenCalledWith(result.infoHash);
  });

  it("does not cancel the prepared probe once already committed", async () => {
    const { stdin, unmount, queue } = renderModal();
    stdin.write(ENTER);
    await tick();
    unmount();
    expect(queue.cancelPrepare).not.toHaveBeenCalled();
  });

  it("Down from the path input moves into the recent list; picking a recent dir commits it", async () => {
    const { stdin, onCommit } = renderModal({ defaultDir: "/dl", recents: ["/games"] });
    stdin.write(DOWN); // path input -> recent row 0 ("/dl", labeled default)
    await tick();
    stdin.write(DOWN); // recent row 0 -> recent row 1 ("/games")
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(onCommit).toHaveBeenCalledWith("/games", []);
  });
});
