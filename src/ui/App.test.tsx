import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { KEY, renderUI, type RenderedUI } from "./testHarness";
import { previewLayout } from "./previewLayout";
import { RAIL_WIDTH } from "./components/Sidebar";
import { SOURCES } from "../sources/registry";
import type { ConcurrentSearchState } from "./hooks/useConcurrentSearch";
import type { Meta } from "../meta/types";
import type { TorrentResult } from "../sources/types";

/**
 * App's own wiring, driven through the real component tree: the region walk the arrow keys
 * produce, the modals that suspend it, and the resize that can take a focused pane out from under
 * the keyboard. Everything below App is either mocked or inert — this file is about which keys
 * move focus where, and nothing else.
 *
 * Every module App touches on boot is stubbed, so mounting it starts no engine, reads no config
 * file, writes no marker and makes no request. The three data hooks are stubbed for the same
 * reason the component tests stub them: no test in this repo may touch the network.
 */
vi.mock("./hooks/useMouseWheel", () => ({ useMouseWheel: (): void => {} }));

vi.mock("../config/config", () => ({
  loadConfig: async (): Promise<unknown> => ({ downloadDir: "/tmp/torlink-tests", trackers: [] }),
  saveConfig: async (): Promise<void> => {},
}));

vi.mock("../download/queue", () => {
  // Enough of the queue for the views that read it: Sidebar's badges and the three store hooks.
  class FakeQueue {
    activeCount = 0;
    seedingCount = 0;
    setTrackers(): void {}
    restore(): void {}
    restoreHistory(): void {}
    restoreSeeds(): void {}
    suspend(): void {}
    persistSync(): void {}
    add(): void {}
    getItems(): unknown[] {
      return [];
    }
    getHistory(): unknown[] {
      return [];
    }
    getSeeds(): unknown[] {
      return [];
    }
    getSeed(): undefined {
      return undefined;
    }
    on(): this {
      return this;
    }
    off(): this {
      return this;
    }
  }
  return { DownloadQueue: FakeQueue };
});

vi.mock("../download/persist", () => ({
  loadQueue: async (): Promise<unknown[]> => [],
  loadSeeds: async (): Promise<unknown[]> => [],
}));
vi.mock("../download/history", () => ({ loadHistory: async (): Promise<unknown[]> => [] }));
vi.mock("../download/reconcile", () => ({ reconcileQueue: (items: unknown): unknown => items }));
vi.mock("../download/bootguard", () => ({
  BOOT_SETTLE_MS: 0,
  armBootMarker: (): void => {},
  disarmBootMarker: (): void => {},
  wasBootInterrupted: (): boolean => false,
}));
vi.mock("../update/version", () => ({
  fetchLatestVersion: async (): Promise<string | null> => null,
  isNewer: (): boolean => false,
}));

const searchState = vi.hoisted(() => ({ current: null as unknown }));
const metaState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("./hooks/useConcurrentSearch", () => ({
  useConcurrentSearch: () => searchState.current,
}));
vi.mock("./hooks/useResultMeta", () => ({ useResultMeta: () => metaState.current }));
vi.mock("./hooks/usePoster", () => ({ usePoster: () => ({ loading: false, cells: null }) }));

const t = (infoHash: string, name: string): TorrentResult => ({
  infoHash,
  name,
  source: "yts",
  sizeBytes: 2.1e9,
  seeders: 40,
  leechers: 6,
  magnet: `magnet:?xt=urn:btih:${infoHash}`,
  added: 1_760_000_000,
});

const LIST = [
  t("a1", "ubuntu 24.04 desktop amd64 iso"),
  t("b2", "ubuntu server 24.04 arm64 iso"),
  t("c3", "debian 12 netinst iso"),
];

const META: Meta = {
  imdbId: "tt0111161",
  kind: "movie",
  title: "The Shawshank Redemption",
  year: "1994",
  rating: "9.3",
  runtime: "142 min",
  genres: ["Drama"],
  cast: ["Tim Robbins", "Morgan Freeman"],
  director: ["Frank Darabont"],
};

function settled(results: TorrentResult[]): ConcurrentSearchState {
  const perSource = Object.fromEntries(
    SOURCES.map((s) => [s.id, { loading: false, error: null, code: null, count: 0 }]),
  ) as ConcurrentSearchState["perSource"];
  return { results, perSource, loading: false, done: SOURCES.length, total: SOURCES.length };
}

let ui: RenderedUI | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

const WIDE = 120;
const contentWidthFor = (cols: number): number => Math.max(24, cols - RAIL_WIDTH - 3);

/** Boots the app and searches, which is the only way into the results view a user has. */
async function boot(cols = WIDE, rows = 30): Promise<RenderedUI> {
  searchState.current = settled(LIST);
  metaState.current = { loading: false, meta: META };
  ui = renderUI(<App onQuit={() => {}} />, { cols, rows });
  const u = ui;
  await vi.waitFor(() => expect(u.frame()).toContain("terminal-native"));
  u.press("linux iso");
  // The field commits what it has rendered, so the query has to be on screen before Enter — a
  // same-tick burst would otherwise submit the empty string the splash opened with.
  await vi.waitFor(() => expect(u.frame()).toContain("linux iso"));
  u.press(KEY.enter);
  await vi.waitFor(() => expect(u.frame()).toContain("Results (3)"));
  return u;
}

// Which region owns the keyboard, read off the footer, because that row is rendered from the same
// `region` the key handler is walking — a claim about focus that the user can also see.
const inPane = (u: RenderedUI): boolean => u.frame().includes("↑↓ Scroll");
const inList = (u: RenderedUI): boolean => u.frame().includes("d Download");
const inSidebar = (u: RenderedUI): boolean => u.frame().includes("q Quit");

// Where the pane's border sits on the shared top-border row, measured from the list panel's own
// left edge so the sidebar rail's width never enters into it. This is the layout's answer to "is
// the pane focused", independent of the footer above.
const paneStartsAt = (u: RenderedUI): number => {
  const line = u.frame().split("\n").find((l) => l.includes("╭─ Results")) ?? "";
  return line.indexOf("╭─ Info") - line.indexOf("╭─ Results");
};
const paneStartFor = (cols: number, focused: boolean): number => {
  const pl = previewLayout(contentWidthFor(cols), focused);
  return pl === null ? -1 : pl.list + 1;
};

describe("App region walk", () => {
  it("steps → from the results list into the info pane, and widens it", async () => {
    const u = await boot();
    expect(inList(u)).toBe(true);
    expect(paneStartsAt(u)).toBe(paneStartFor(WIDE, false));

    u.press(KEY.right);
    await vi.waitFor(() => expect(inPane(u)).toBe(true));
    // Not just a footer swap: the split moved to the focused widths under it.
    expect(paneStartsAt(u)).toBe(paneStartFor(WIDE, true));
    expect(inList(u)).toBe(false);
  });

  it("accepts l for the same step, as every other horizontal key in this app does", async () => {
    const u = await boot();
    u.press("l");
    await vi.waitFor(() => expect(inPane(u)).toBe(true));
  });

  it("steps ← back to the list, never past it to the sidebar", async () => {
    const u = await boot();
    u.press(KEY.right);
    await vi.waitFor(() => expect(inPane(u)).toBe(true));

    u.press(KEY.left);
    await vi.waitFor(() => expect(inList(u)).toBe(true));
    // The whole point of a three-column model: one key, one column.
    expect(inSidebar(u)).toBe(false);
    expect(paneStartsAt(u)).toBe(paneStartFor(WIDE, false));

    // And the step after it lands where ← always landed.
    u.press(KEY.left);
    await vi.waitFor(() => expect(inSidebar(u)).toBe(true));
  });

  it("steps esc left exactly as ← does, all the way out to the splash", async () => {
    const u = await boot();
    u.press(KEY.right);
    await vi.waitFor(() => expect(inPane(u)).toBe(true));

    u.press(KEY.esc);
    await vi.waitFor(() => expect(inList(u)).toBe(true));
    expect(inSidebar(u)).toBe(false);

    u.press(KEY.esc);
    await vi.waitFor(() => expect(inSidebar(u)).toBe(true));

    u.press(KEY.esc);
    await vi.waitFor(() => expect(u.frame()).toContain("terminal-native"));
  });

  it("leaves tab the two-way toggle it has always been", async () => {
    const u = await boot();
    u.press(KEY.right);
    await vi.waitFor(() => expect(inPane(u)).toBe(true));

    u.press("\t");
    await vi.waitFor(() => expect(inSidebar(u)).toBe(true));
  });

  it("keeps → a no-op where the pane cannot exist", async () => {
    const u = await boot(80);
    expect(u.frame()).not.toContain("╭─ Info");

    u.press(KEY.right);
    await new Promise((r) => setTimeout(r, 30));
    expect(inPane(u)).toBe(false);
    expect(inList(u)).toBe(true);
  });

  it("keeps → a no-op once the pane is toggled off, and honours it again after i", async () => {
    const u = await boot();
    u.press("i");
    await vi.waitFor(() => expect(u.frame()).not.toContain("╭─ Info"));

    u.press(KEY.right);
    await new Promise((r) => setTimeout(r, 30));
    expect(inPane(u)).toBe(false);

    u.press("i");
    await vi.waitFor(() => expect(u.frame()).toContain("╭─ Info"));
    u.press(KEY.right);
    await vi.waitFor(() => expect(inPane(u)).toBe(true));
  });
});

describe("App footer for the info pane", () => {
  it("advertises → while the pane is open and i once it is closed", async () => {
    const u = await boot();
    expect(u.frame()).toContain("→ Info");
    expect(u.frame()).not.toContain("i Info");

    u.press("i");
    await vi.waitFor(() => expect(u.frame()).toContain("i Info"));
    expect(u.frame()).not.toContain("→ Info");
  });
});

describe("App modals over a focused pane", () => {
  it("returns the keyboard to the pane after the ? sheet closes", async () => {
    const u = await boot();
    u.press(KEY.right);
    await vi.waitFor(() => expect(inPane(u)).toBe(true));

    u.press("?");
    await vi.waitFor(() => expect(u.frame()).toContain("Keyboard"));
    // The body is hidden while the overlay owns the screen, so nothing behind it is holding keys.
    expect(u.frame()).not.toContain("╭─ Results");
    expect(inPane(u)).toBe(false);

    u.press("?");
    await vi.waitFor(() => expect(inPane(u)).toBe(true));
    expect(paneStartsAt(u)).toBe(paneStartFor(WIDE, true));
  });

  it("returns it after the folder prompt is cancelled", async () => {
    const u = await boot();
    u.press(KEY.right);
    await vi.waitFor(() => expect(inPane(u)).toBe(true));

    u.press("o");
    await vi.waitFor(() => expect(u.frame()).toContain("Default download folder"));
    expect(u.frame()).not.toContain("╭─ Results");

    u.press(KEY.esc);
    await vi.waitFor(() => expect(inPane(u)).toBe(true));
  });

  it("returns it after the trackers prompt is cancelled", async () => {
    const u = await boot();
    u.press(KEY.right);
    await vi.waitFor(() => expect(inPane(u)).toBe(true));

    u.press("t");
    await vi.waitFor(() => expect(u.frame()).toContain("Extra trackers"));

    u.press(KEY.esc);
    await vi.waitFor(() => expect(inPane(u)).toBe(true));
  });
});

describe("App rescues focus from a pane that disappears", () => {
  it("hands the keyboard back to the list when a resize takes the pane away", async () => {
    const u = await boot();
    u.press(KEY.right);
    await vi.waitFor(() => expect(inPane(u)).toBe(true));

    // 80 columns is below the width the split exists at: the pane goes, and the keyboard cannot
    // be left holding it — every key would be feeding a column that is no longer drawn.
    u.resize(80, 30);
    await vi.waitFor(() => expect(u.frame()).not.toContain("╭─ Info"));
    await vi.waitFor(() => expect(inList(u)).toBe(true));
    expect(inPane(u)).toBe(false);

    // And the rescue moved the state, not just the frame: widening again leaves focus where the
    // user last had it rather than teleporting it back into the pane.
    u.resize(WIDE, 30);
    await vi.waitFor(() => expect(u.frame()).toContain("╭─ Info"));
    expect(inList(u)).toBe(true);
    expect(paneStartsAt(u)).toBe(paneStartFor(WIDE, false));
  });

  it("leaves nothing stranded when the results view itself goes away", async () => {
    const u = await boot();
    u.press(KEY.right);
    await vi.waitFor(() => expect(inPane(u)).toBe(true));

    // Out to the sidebar and up into Downloads, which has no pane at any width. One key per
    // frame: a burst arrives as a single chunk, and ink hands the whole chunk over as one `input`.
    u.press("\t");
    await vi.waitFor(() => expect(inSidebar(u)).toBe(true));
    u.press("k");
    await vi.waitFor(() => expect(u.frame()).toContain("╭─ Seeding"));
    u.press("k");
    await vi.waitFor(() => expect(u.frame()).toContain("╭─ Downloads"));
    u.press(KEY.enter);
    await vi.waitFor(() => expect(u.frame()).toContain("p Pause"));

    // → here must find no third column: the results view reported its pane gone on the way out.
    u.press(KEY.right);
    await new Promise((r) => setTimeout(r, 30));
    expect(inPane(u)).toBe(false);
    expect(u.frame()).toContain("p Pause");
  });
});
