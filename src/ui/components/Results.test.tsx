import { afterEach, describe, expect, it, vi } from "vitest";
import { SOURCES } from "../../sources/registry";
import { StoreContext, type Store } from "../store";
import {
  KEY,
  makeTestStore,
  renderUI,
  TEST_CONTENT_WIDTH,
  type RenderedUI,
} from "../testHarness";
import { Results } from "./Results";
import type { ConcurrentSearchState } from "../hooks/useConcurrentSearch";
import type { TorrentResult } from "../../sources/types";

const searchState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../hooks/useConcurrentSearch", () => ({
  useConcurrentSearch: () => searchState.current,
}));

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

// Invented names. "ubuntu 24" exercises all three rank tiers: exact substring
// (a1), tokens in order (b2), tokens scattered (c3).
const LIST = [
  t("a1", "ubuntu 24.04 desktop amd64 iso"),
  t("b2", "ubuntu server 24.04 arm64 iso"),
  t("c3", "24 hour timelapse of ubuntu builds"),
  t("d4", "debian 12 netinst iso"),
  t("e5", "arch linux 2026.07 iso"),
  t("f6", "fedora workstation 42 iso"),
  t("g7", "gentoo stage3 tarball"),
  t("h8", "mint cinnamon 22 iso"),
];

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

async function mount(
  results: TorrentResult[] = LIST,
  store: Partial<Store> = {},
): Promise<RenderedUI> {
  searchState.current = settled(results);
  ui = renderUI(
    <StoreContext.Provider value={makeTestStore({ query: "linux iso", ...store })}>
      <Results />
    </StoreContext.Provider>,
  );
  const u = ui;
  await vi.waitFor(() => expect(u.frame()).toContain(`Results (${results.length})`));
  return u;
}

const lines = (u: RenderedUI): string[] => u.frame().split("\n");
const lineIndex = (u: RenderedUI, needle: string): number =>
  lines(u).findIndex((l) => l.includes(needle));
// The TextField cursor renders as SGR inverse; nothing else in this view does.
const editing = (u: RenderedUI): boolean => u.rawFrame().includes(`${KEY.esc}[7m`);

async function openFilter(u: RenderedUI): Promise<void> {
  u.press("f");
  await vi.waitFor(() => expect(editing(u)).toBe(true));
}

async function type(u: RenderedUI, text: string, expectCount: number): Promise<void> {
  u.press(text);
  await vi.waitFor(() => expect(u.frame()).toContain(`(${expectCount})`));
}

describe("Results filter UI", () => {
  it("shows no filter bar by default", async () => {
    const u = await mount();
    expect(u.frame()).not.toContain("Filter");
  });

  it("renders the filter bar on its own row below an intact panel", async () => {
    const u = await mount();
    await openFilter(u);
    await type(u, "ubuntu 24", 3);

    const ls = lines(u);
    const top = ls.findIndex((l) => l.includes("╭─ Results"));
    const bar = ls.findIndex((l) => l.includes("Filter ❯"));
    const lastBorder = ls.reduce((acc, l, i) => (l.includes("╰") ? i : acc), -1);

    // The bug this guards against: the bar rendered as a row sibling of the
    // panel, landing on the top border line and squeezing the title.
    expect(ls[top]).toMatch(/^╭─ Results \(3\) ─+╮$/);
    expect(ls[top]).toHaveLength(TEST_CONTENT_WIDTH);
    expect(bar).toBeGreaterThan(lastBorder);
    for (const l of ls) expect(l.length).toBeLessThanOrEqual(TEST_CONTENT_WIDTH);
  });

  it("narrows live and ranks exact > in-order > scattered", async () => {
    const u = await mount();
    await openFilter(u);
    await type(u, "ubuntu 24", 3);

    const exact = lineIndex(u, "ubuntu 24.04 desktop");
    const inOrder = lineIndex(u, "ubuntu server");
    const scattered = lineIndex(u, "24 hour timelapse");
    expect(exact).toBeGreaterThan(-1);
    expect(inOrder).toBeGreaterThan(exact);
    expect(scattered).toBeGreaterThan(inOrder);
    expect(u.frame()).not.toContain("debian 12");
  });

  it("enter commits the filter and returns keys to the list", async () => {
    const u = await mount();
    await openFilter(u);
    await type(u, "iso", 6);
    u.press(KEY.enter);
    await vi.waitFor(() => expect(editing(u)).toBe(false));
    expect(u.frame()).toContain("Filter ❯ iso");

    u.press("j");
    await vi.waitFor(() => {
      const ls = lines(u);
      expect(ls.find((l) => l.includes("ubuntu server"))).toContain("❯");
    });
    expect(lines(u).find((l) => l.includes("ubuntu 24.04 desktop"))).not.toContain("❯");
  });

  it("esc leaves editing but keeps the filter applied", async () => {
    const u = await mount();
    await openFilter(u);
    await type(u, "iso", 6);
    u.press(KEY.esc);
    await vi.waitFor(() => expect(editing(u)).toBe(false));
    expect(u.frame()).toContain("Filter ❯ iso");
    expect(u.frame()).toContain("(6)");

    u.press("j");
    await vi.waitFor(() => {
      const ls = lines(u);
      expect(ls.find((l) => l.includes("ubuntu server"))).toContain("❯");
    });
  });

  it("ctrl+u then enter clears the filter and removes the bar", async () => {
    const u = await mount();
    await openFilter(u);
    await type(u, "arch", 1);
    u.press(KEY.ctrlU);
    await vi.waitFor(() => expect(u.frame()).toContain("(8)"));
    u.press(KEY.enter);
    await vi.waitFor(() => expect(u.frame()).not.toContain("Filter"));
    expect(u.frame()).toContain("Results (8)");
  });

  it("a zero-match filter never traps the user", async () => {
    const u = await mount();
    await openFilter(u);
    u.press("zzz");
    await vi.waitFor(() => expect(u.frame()).toContain("No results for"));
    u.press(KEY.enter);
    await vi.waitFor(() => expect(editing(u)).toBe(false));
    expect(u.frame()).toContain("Filter ❯ zzz");

    u.press("f");
    await vi.waitFor(() => expect(editing(u)).toBe(true));
    u.press(KEY.ctrlU);
    // Wait between keys: TextField's input closure only refreshes on render,
    // so a same-batch ctrl+u + enter would still submit the pre-clear value
    // (pre-existing TextField trait, logged as a follow-up).
    await vi.waitFor(() => expect(u.frame()).toContain("Results (8)"));
    u.press(KEY.enter);
    await vi.waitFor(() => expect(u.frame()).not.toContain("Filter"));
    expect(u.frame()).toContain("Results (8)");
  });
});

describe("Results multi-select", () => {
  const rowOf = (u: RenderedUI, needle: string): string =>
    lines(u).find((l) => l.includes(needle)) ?? "";

  it("space marks the row under the cursor and space again unmarks it", async () => {
    const u = await mount();
    expect(rowOf(u, "ubuntu 24.04 desktop")).not.toContain("✓");

    u.press(KEY.space);
    await vi.waitFor(() => expect(rowOf(u, "ubuntu 24.04 desktop")).toContain("✓"));
    expect(rowOf(u, "ubuntu server")).not.toContain("✓");

    u.press(KEY.space);
    await vi.waitFor(() => expect(rowOf(u, "ubuntu 24.04 desktop")).not.toContain("✓"));
  });

  it("d downloads every marked row, in list order, and nothing else", async () => {
    const startDownload = vi.fn();
    const u = await mount(LIST, { startDownload });

    // One key per render: bytes pressed in the same tick reach Ink as a single
    // multi-char string (" j"), which matches no binding.
    u.press(KEY.space); // a1
    await vi.waitFor(() => expect(rowOf(u, "ubuntu 24.04 desktop")).toContain("✓"));
    u.press("j");
    await vi.waitFor(() => expect(rowOf(u, "ubuntu server")).toContain("❯"));
    u.press("j");
    await vi.waitFor(() => expect(rowOf(u, "24 hour timelapse")).toContain("❯"));
    u.press(KEY.space); // c3
    await vi.waitFor(() => expect(rowOf(u, "24 hour timelapse")).toContain("✓"));

    u.press("d");
    await vi.waitFor(() => expect(startDownload).toHaveBeenCalledTimes(2));
    expect(startDownload.mock.calls.map(([r]) => r.id)).toEqual(["a1", "c3"]);
  });

  it("d with no marks still downloads just the row under the cursor", async () => {
    const startDownload = vi.fn();
    const u = await mount(LIST, { startDownload });
    u.press("d");
    await vi.waitFor(() => expect(startDownload).toHaveBeenCalledTimes(1));
    expect(startDownload.mock.calls[0]![0].id).toBe("a1");
  });

  it("clears the marks once they are downloaded", async () => {
    const startDownload = vi.fn();
    const u = await mount(LIST, { startDownload });
    u.press(KEY.space);
    await vi.waitFor(() => expect(rowOf(u, "ubuntu 24.04 desktop")).toContain("✓"));
    u.press("d");
    await vi.waitFor(() => expect(rowOf(u, "ubuntu 24.04 desktop")).not.toContain("✓"));

    u.press("d");
    await vi.waitFor(() => expect(startDownload).toHaveBeenCalledTimes(2));
    // 1 from the batch + 1 plain press: the marks were not replayed.
    expect(startDownload.mock.calls.map(([r]) => r.id)).toEqual(["a1", "a1"]);
  });

  it("ignores marks hidden by a filter and falls back to the cursor row", async () => {
    const startDownload = vi.fn();
    const u = await mount(LIST, { startDownload });
    u.press(KEY.space); // a1 (ubuntu)
    await vi.waitFor(() => expect(rowOf(u, "ubuntu 24.04 desktop")).toContain("✓"));

    await openFilter(u);
    await type(u, "debian", 1);
    u.press(KEY.enter);
    await vi.waitFor(() => expect(editing(u)).toBe(false));
    u.press("d");
    await vi.waitFor(() => expect(startDownload).toHaveBeenCalled());
    expect(startDownload.mock.calls.map(([r]) => r.id)).toEqual(["d4"]);
  });

  it("D opens one folder prompt for every marked row", async () => {
    const requestDownloadTo = vi.fn();
    const startDownload = vi.fn();
    const u = await mount(LIST, { requestDownloadTo, startDownload });

    u.press(KEY.space); // a1
    await vi.waitFor(() => expect(rowOf(u, "ubuntu 24.04 desktop")).toContain("✓"));
    u.press("j");
    await vi.waitFor(() => expect(rowOf(u, "ubuntu server")).toContain("❯"));
    u.press(KEY.space); // b2
    await vi.waitFor(() => expect(rowOf(u, "ubuntu server")).toContain("✓"));

    u.press("D");
    await vi.waitFor(() => expect(requestDownloadTo).toHaveBeenCalledTimes(1));
    expect(requestDownloadTo.mock.calls[0]![0].map((r: { id: string }) => r.id)).toEqual([
      "a1",
      "b2",
    ]);
    expect(startDownload).not.toHaveBeenCalled();
  });

  it("D keeps the marks until the folder prompt reports the downloads queued", async () => {
    const requestDownloadTo = vi.fn();
    const u = await mount(LIST, { requestDownloadTo });
    u.press(KEY.space);
    await vi.waitFor(() => expect(rowOf(u, "ubuntu 24.04 desktop")).toContain("✓"));

    u.press("D");
    await vi.waitFor(() => expect(requestDownloadTo).toHaveBeenCalledTimes(1));
    // A cancelled prompt never calls back, so the selection must still be there.
    expect(rowOf(u, "ubuntu 24.04 desktop")).toContain("✓");

    const onQueued = requestDownloadTo.mock.calls[0]![1] as () => void;
    onQueued();
    await vi.waitFor(() => expect(u.frame()).not.toContain("✓"));
  });

  it("keeps the tick in the same column with or without the pointer", async () => {
    const u = await mount();
    u.press(KEY.space);
    await vi.waitFor(() => expect(rowOf(u, "ubuntu 24.04 desktop")).toContain("✓"));
    const underPointer = rowOf(u, "ubuntu 24.04 desktop");
    expect(underPointer).toContain("❯");

    u.press("j");
    await vi.waitFor(() => expect(rowOf(u, "ubuntu 24.04 desktop")).not.toContain("❯"));
    const away = rowOf(u, "ubuntu 24.04 desktop");
    expect(away.indexOf("✓")).toBe(underPointer.indexOf("✓"));
    // A space separates the pointer from the tick.
    expect(underPointer).toMatch(/❯ ✓/);
  });

  it("D with no marks requests just the row under the cursor", async () => {
    const requestDownloadTo = vi.fn();
    const u = await mount(LIST, { requestDownloadTo });
    u.press("D");
    await vi.waitFor(() => expect(requestDownloadTo).toHaveBeenCalledTimes(1));
    expect(requestDownloadTo.mock.calls[0]![0].map((r: { id: string }) => r.id)).toEqual(["a1"]);
  });
});
