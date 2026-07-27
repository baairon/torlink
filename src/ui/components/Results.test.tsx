import { afterEach, describe, expect, it, vi } from "vitest";
import { SOURCES } from "../../sources/registry";
import { StoreContext } from "../store";
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

// Prevent real OS-clipboard calls; spy lets tests verify what was written.
const clipboardWrite = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("../../util/clipboard", () => ({
  readClipboard: vi.fn().mockResolvedValue(""),
  writeClipboard: clipboardWrite,
}));


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

async function mount(results: TorrentResult[] = LIST): Promise<RenderedUI> {
  searchState.current = settled(results);
  ui = renderUI(
    <StoreContext.Provider value={makeTestStore({ query: "linux iso" })}>
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

// ─── Details panel ───────────────────────────────────────────────────────────

const HASH = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
const TR1 = "udp://tracker.opentrackr.org:1337/announce";
const TR2 = "udp://open.stealth.si:80/announce";

const withTrackers: TorrentResult = {
  infoHash: HASH,
  name: "Cool Movie 2024 1080p BluRay",
  source: "yts",
  sizeBytes: 2_800_000_000,
  seeders: 842,
  leechers: 91,
  magnet: `magnet:?xt=urn:btih:${HASH}&dn=Cool+Movie+2024&tr=${encodeURIComponent(TR1)}&tr=${encodeURIComponent(TR2)}`,
  added: 1_760_000_000,
};

// Render with enough rows that the detail panel is never clipped by the
// terminal height. 40 rows is generous; the panel fits in ~18.
async function mountDetail(result = withTrackers): Promise<RenderedUI> {
  searchState.current = settled([result]);
  const startDownload = vi.fn();
  const copyMagnet = vi.fn();
  const setNotice = vi.fn();
  const store = makeTestStore({
    query: "cool movie",
    startDownload,
    copyMagnet,
    setNotice,
    // Larger budget so detail rows are never scrolled off.
    listRows: 30,
    rows: 40,
  });
  const u = renderUI(
    <StoreContext.Provider value={store}>
      <Results />
    </StoreContext.Provider>,
    { rows: 40 },
  );
  await vi.waitFor(() => expect(u.frame()).toContain("Results (1)"));
  return u;
}

// Panel.tsx capitalises the first letter of its title prop.
const PANEL_TITLE = "Details";

describe("Details panel", () => {
  afterEach(() => {
    clipboardWrite.mockClear();
  });

  it("pressing i opens the detail panel and shows the title", async () => {
    const u = await mountDetail();
    u.press("i");
    await vi.waitFor(() => expect(u.frame()).toContain(PANEL_TITLE));
    expect(u.frame()).toContain("Cool Movie 2024 1080p BluRay");
  });

  it("pressing Enter also opens the detail panel (regression guard)", async () => {
    const u = await mountDetail();
    u.press(KEY.enter);
    await vi.waitFor(() => expect(u.frame()).toContain(PANEL_TITLE));
    expect(u.frame()).toContain("Cool Movie 2024 1080p BluRay");
  });

  it("Esc from detail mode returns to the list", async () => {
    const u = await mountDetail();
    u.press("i");
    await vi.waitFor(() => expect(u.frame()).toContain(PANEL_TITLE));
    u.press(KEY.esc);
    await vi.waitFor(() => expect(u.frame()).toContain("Results (1)"));
    expect(u.frame()).not.toContain("Trackers");
  });

  it("shows the infohash inside the detail panel", async () => {
    const u = await mountDetail();
    u.press("i");
    await vi.waitFor(() => expect(u.frame()).toContain(PANEL_TITLE));
    expect(u.frame()).toContain(HASH);
  });

  it("shows tracker URLs when the magnet contains tr= parameters", async () => {
    const u = await mountDetail();
    u.press("i");
    await vi.waitFor(() => expect(u.frame()).toContain("Trackers"));
    // Tracker lines may be truncated at terminal width; check a unique prefix.
    expect(u.frame()).toContain("tracker.opentrackr.org");
    expect(u.frame()).toContain("open.stealth.si");
  });

  it("does not show the Trackers section when the magnet has no tr= params", async () => {
    const bare: TorrentResult = { ...withTrackers, magnet: `magnet:?xt=urn:btih:${HASH}&dn=X` };
    const u = await mountDetail(bare);
    u.press("i");
    await vi.waitFor(() => expect(u.frame()).toContain(PANEL_TITLE));
    expect(u.frame()).not.toContain("Trackers");
  });

  it("h copies the infohash to the clipboard", async () => {
    const u = await mountDetail();
    u.press("i");
    await vi.waitFor(() => expect(u.frame()).toContain(PANEL_TITLE));
    u.press("h");
    await vi.waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith(HASH));
  });
});
