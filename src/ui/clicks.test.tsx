import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Box, useInput } from "ink";
import { SOURCES } from "../sources/registry";
import { StoreContext, type Region, type Section, type Store } from "./store";
import { fakeQueue, makeTestStore, renderUI, type RenderedUI } from "./testHarness";
import { MouseProvider } from "./mouse";
import { footerHints, hintAt } from "./keymap";
import { clickSort } from "./sort";
import { Results } from "./components/Results";
import { Downloads } from "./components/Downloads";
import { Seeding } from "./components/Seeding";
import { Sidebar } from "./components/Sidebar";
import { Footer } from "./components/Footer";
import { HelpOverlay } from "./components/HelpOverlay";
import { PromptHints } from "./components/PromptHints";
import type { ConcurrentSearchState } from "./hooks/useConcurrentSearch";
import type { TorrentResult } from "../sources/types";
import type { QueueItem } from "../download/types";
import type { HistoryItem } from "../download/history";
import type { ReactNode } from "react";

const searchState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("./hooks/useConcurrentSearch", () => ({
  useConcurrentSearch: () => searchState.current,
}));

const t = (infoHash: string, name: string, sizeBytes: number, seeders: number): TorrentResult => ({
  infoHash,
  name,
  source: "yts",
  sizeBytes,
  seeders,
  leechers: 1,
  magnet: `magnet:?xt=urn:btih:${infoHash}`,
  added: 1_760_000_000,
});

// Default order is most seeded first: alpha, bravo, charlie.
const LIST = [
  t("a1", "alpha desktop iso", 1e9, 30),
  t("b2", "bravo server iso", 3e9, 20),
  t("c3", "charlie netinst iso", 2e9, 10),
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

// Ink only reads stdin while some useInput is mounted; the real app always
// has one (App's), these single-component mounts may not.
function Listening({ seen }: { seen?: string[] }) {
  useInput((input, key) => {
    seen?.push(key.return ? "enter" : key.escape ? "esc" : key.tab ? "tab" : input);
  });
  return null;
}

function mount(node: ReactNode, store: Partial<Store> = {}, seen?: string[]): RenderedUI {
  ui = renderUI(
    <MouseProvider>
      <StoreContext.Provider value={makeTestStore(store)}>
        <Listening seen={seen} />
        {node}
      </StoreContext.Provider>
    </MouseProvider>,
  );
  return ui;
}

const lineWith = (u: RenderedUI, needle: string): string =>
  u.frame().split("\n").find((l) => l.includes(needle)) ?? "";
const order = (u: RenderedUI): string[] =>
  u
    .frame()
    .split("\n")
    .map((l) => /(alpha|bravo|charlie)/.exec(l)?.[1])
    .filter((n): n is string => !!n);

describe("clickSort", () => {
  it("goes biggest first, then smallest first, then back to default", () => {
    const first = clickSort("none", "size");
    expect(first).toEqual({ field: "size", dir: "desc" });
    const second = clickSort(first, "size");
    expect(second).toEqual({ field: "size", dir: "asc" });
    expect(clickSort(second, "size")).toBe("none");
  });

  it("starts a different column fresh, and sources A-Z", () => {
    expect(clickSort({ field: "size", dir: "asc" }, "seeders")).toEqual({
      field: "seeders",
      dir: "desc",
    });
    expect(clickSort("none", "source")).toEqual({ field: "source", dir: "asc" });
  });
});

describe("hintAt", () => {
  const hints = footerHints("content", "downloads", "downloading", null);
  // "p Pause   c Cancel   e Folder   s Export   tab Switch   ? Keys"

  it("finds the hint under a column, key or label", () => {
    expect(hintAt(hints, 0)?.keys).toBe("p");
    expect(hintAt(hints, 6)?.keys).toBe("p");
    expect(hintAt(hints, 10)?.keys).toBe("c");
    expect(hintAt(hints, 43)?.keys).toBe("tab");
  });

  it("finds nothing in the gaps or past the end", () => {
    expect(hintAt(hints, 7)).toBeNull();
    expect(hintAt(hints, 9)).toBeNull();
    expect(hintAt(hints, 200)).toBeNull();
  });
});

describe("clicking results", () => {
  async function mountResults(store: Partial<Store> = {}): Promise<RenderedUI> {
    searchState.current = settled(LIST);
    const u = mount(<Results />, { query: "iso", ...store });
    await vi.waitFor(() => expect(u.frame()).toContain("Results (3)"));
    return u;
  }

  it("moves the cursor to the clicked row", async () => {
    const u = await mountResults();
    expect(lineWith(u, "alpha")).toContain("❯");
    u.clickText("charlie netinst");
    await vi.waitFor(() => expect(lineWith(u, "charlie")).toContain("❯"));
    expect(lineWith(u, "alpha")).not.toContain("❯");
  });

  it("opens the row the cursor is already on", async () => {
    const u = await mountResults();
    u.clickText("bravo server");
    await vi.waitFor(() => expect(lineWith(u, "bravo")).toContain("❯"));
    u.clickText("bravo server");
    await vi.waitFor(() => expect(u.frame()).toContain("Details"));
    expect(u.frame()).toContain("magnet:?xt=urn:btih:b2");
  });

  it("opens the same details enter does", async () => {
    const byKey = await mountResults();
    byKey.press("\r");
    await vi.waitFor(() => expect(byKey.frame()).toContain("Details"));
    const expected = byKey.frame();
    byKey.unmount();

    const byClick = await mountResults();
    byClick.clickText("alpha desktop");
    await vi.waitFor(() => expect(byClick.frame()).toContain("Details"));
    expect(byClick.frame()).toBe(expected);
  });

  it("takes focus from the sidebar when a row is clicked", async () => {
    const setRegion = vi.fn();
    const u = await mountResults({ region: "sidebar", setRegion });
    u.clickText("bravo server");
    await vi.waitFor(() => expect(setRegion).toHaveBeenCalledWith("content"));
  });

  it("runs the detail actions and goes back", async () => {
    const startDownload = vi.fn();
    const copyMagnet = vi.fn();
    const u = await mountResults({ startDownload, copyMagnet });
    u.clickText("alpha desktop");
    await vi.waitFor(() => expect(u.frame()).toContain("Details"));

    u.clickText("Copy");
    await vi.waitFor(() =>
      expect(copyMagnet).toHaveBeenCalledWith({
        name: "alpha desktop iso",
        magnet: "magnet:?xt=urn:btih:a1",
      }),
    );
    u.clickText("d Download");
    await vi.waitFor(() =>
      expect(startDownload).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" })),
    );
    u.clickText("esc back");
    await vi.waitFor(() => expect(u.frame()).toContain("Results (3)"));
  });

  it("sorts by a clicked column header", async () => {
    const u = await mountResults();
    expect(order(u)).toEqual(["alpha", "bravo", "charlie"]);
    u.clickText("Size");
    await vi.waitFor(() => expect(order(u)).toEqual(["bravo", "charlie", "alpha"]));
    u.clickText("Size");
    await vi.waitFor(() => expect(order(u)).toEqual(["alpha", "charlie", "bravo"]));
    u.clickText("Size");
    await vi.waitFor(() => expect(order(u)).toEqual(["alpha", "bravo", "charlie"]));
  });

  it("starts editing the search when the search box is clicked", async () => {
    const u = await mountResults();
    const inverse = "\u001b[7m"; // the text field's cursor
    expect(u.rawFrame()).not.toContain(inverse);
    u.clickText("╭─ Search");
    await vi.waitFor(() => expect(u.rawFrame()).toContain(inverse));
  });

  it("does not type a click into the search field", async () => {
    const u = await mountResults();
    u.press("/");
    await vi.waitFor(() => expect(u.rawFrame()).toContain("\u001b[7m"));
    u.press("x");
    await vi.waitFor(() => expect(lineWith(u, "❯ isox")).not.toBe(""));
    u.click(40, 1);
    u.press("y");
    await vi.waitFor(() => expect(lineWith(u, "❯ isoxy")).not.toBe(""));
  });

  it("scrolls the list with the wheel", async () => {
    const u = await mountResults();
    u.wheel("down");
    await vi.waitFor(() => expect(lineWith(u, "bravo")).toContain("❯"));
    u.wheel("up");
    await vi.waitFor(() => expect(lineWith(u, "alpha")).toContain("❯"));
  });
});

describe("clicking a tab from the results pane", () => {
  // The real app's wiring for the two pieces of state a tab click touches.
  function Shell() {
    const [section, setSection] = useState<Section>("all");
    const [region, setRegion] = useState<Region>("content");
    return (
      <StoreContext.Provider
        value={makeTestStore({ query: "iso", section, setSection, region, setRegion })}
      >
        <Box>
          <Sidebar />
          <Results />
        </Box>
      </StoreContext.Provider>
    );
  }

  async function mountShell(): Promise<RenderedUI> {
    searchState.current = settled(LIST);
    ui = renderUI(
      <MouseProvider>
        <Shell />
      </MouseProvider>,
    );
    const u = ui;
    await vi.waitFor(() => expect(u.frame()).toContain("Results (3)"));
    return u;
  }

  it("closes the open details instead of leaving them over the new tab", async () => {
    const u = await mountShell();
    u.clickText("alpha desktop");
    await vi.waitFor(() => expect(u.frame()).toContain("Details"));
    u.clickText("Movies");
    await vi.waitFor(() => expect(u.frame()).toContain("Results (3)"));
    expect(u.frame()).not.toContain("Details");
    expect(lineWith(u, "Movies")).toContain("▌");
  });

  it("drops an open filter field with its text", async () => {
    const u = await mountShell();
    u.press("f");
    await vi.waitFor(() => expect(u.frame()).toContain("Filter ❯"));
    u.press("bravo");
    await vi.waitFor(() => expect(u.frame()).toContain("Results (1)"));
    u.clickText("Movies");
    await vi.waitFor(() => expect(u.frame()).toContain("Results (3)"));
    expect(u.frame()).not.toContain("Filter ❯");
  });
});

describe("clicking downloads and seeding", () => {
  const NOW_MS = 1_760_000_000_000;
  const active: QueueItem[] = [
    {
      id: "q1",
      name: "fedora workstation iso",
      source: "yts",
      magnet: "magnet:?xt=urn:btih:q1",
      dir: "/dl",
      status: "downloading",
      progress: 40,
      totalBytes: 2e9,
      downloadedBytes: 8e8,
      speed: 5e6,
      peers: 12,
      eta: 240,
      addedAt: NOW_MS,
    },
  ];
  const recent: HistoryItem[] = ["ubuntu desktop iso", "debian netinst iso"].map((name, i) => ({
    id: `h${i}`,
    name,
    source: "eztv",
    sizeBytes: 1.5e9,
    magnet: `magnet:?xt=urn:btih:h${i}`,
    dir: "/dl",
    completedAt: NOW_MS,
  }));

  it("selects a clicked download without acting on it", async () => {
    const queue = fakeQueue(active, recent);
    const cancel = vi.spyOn(queue, "cancel");
    const removeHistory = vi.spyOn(queue, "removeHistory");
    const startDownload = vi.fn();
    const u = mount(<Downloads />, { queue, section: "downloads", startDownload });
    await vi.waitFor(() => expect(lineWith(u, "fedora")).toContain("❯"));

    u.clickText("debian netinst");
    await vi.waitFor(() => expect(lineWith(u, "debian")).toContain("❯"));
    u.clickText("debian netinst");
    u.clickText("fedora workstation");
    await vi.waitFor(() => expect(lineWith(u, "fedora")).toContain("❯"));

    expect(cancel).not.toHaveBeenCalled();
    expect(removeHistory).not.toHaveBeenCalled();
    expect(startDownload).not.toHaveBeenCalled();
  });

  it("selects an active download by its progress row too", async () => {
    const queue = fakeQueue(active, recent);
    const u = mount(<Downloads />, { queue, section: "downloads" });
    await vi.waitFor(() => expect(u.frame()).toContain("40%"));
    u.clickText("ubuntu desktop");
    await vi.waitFor(() => expect(lineWith(u, "ubuntu")).toContain("❯"));
    u.clickText("40%");
    await vi.waitFor(() => expect(lineWith(u, "fedora")).toContain("❯"));
  });

  it("selects a clicked seeding row", async () => {
    const queue = fakeQueue([], recent);
    const u = mount(<Seeding />, { queue, section: "seeding" });
    await vi.waitFor(() => expect(lineWith(u, "ubuntu")).toContain("❯"));
    u.clickText("debian netinst");
    await vi.waitFor(() => expect(lineWith(u, "debian")).toContain("❯"));
  });
});

describe("clicking the chrome", () => {
  it("opens a sidebar tab", async () => {
    const setSection = vi.fn();
    const setRegion = vi.fn();
    const u = mount(<Sidebar />, { setSection, setRegion, region: "sidebar" });
    await vi.waitFor(() => expect(u.frame()).toContain("Seeding"));
    u.clickText("Movies");
    await vi.waitFor(() => expect(setSection).toHaveBeenCalledWith("movies"));
    expect(setRegion).toHaveBeenCalledWith("content");
    u.clickText("Seeding");
    await vi.waitFor(() => expect(setSection).toHaveBeenCalledWith("seeding"));
  });

  it("runs the key of a clicked footer hint", async () => {
    const onPress = vi.fn();
    const hints = footerHints("content", "downloads", "downloading", null);
    const u = mount(<Footer hints={hints} onPress={onPress} />);
    await vi.waitFor(() => expect(u.frame()).toContain("Cancel"));
    u.clickText("Cancel");
    await vi.waitFor(() => expect(onPress).toHaveBeenCalledWith("c"));
    u.clickText("tab Switch");
    await vi.waitFor(() => expect(onPress).toHaveBeenCalledWith("\t"));
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it("does nothing for the arrows hint, which names no single key", async () => {
    const onPress = vi.fn();
    const seen: string[] = [];
    const u = mount(<Footer hints={footerHints("content", "all")} onPress={onPress} />, {}, seen);
    await vi.waitFor(() => expect(u.frame()).toContain("Move"));
    u.clickText("Move");
    u.press("z");
    await vi.waitFor(() => expect(seen).toContain("z"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("types enter and esc from the prompt hints", async () => {
    const seen: string[] = [];
    const u = mount(<PromptHints submitLabel="save" />, {}, seen);
    await vi.waitFor(() => expect(u.frame()).toContain("save"));
    u.clickText("save");
    await vi.waitFor(() => expect(seen).toEqual(["enter"]));
    u.clickText("esc cancel");
    await vi.waitFor(() => expect(seen).toEqual(["enter", "esc"]));
  });

  it("picks a key from the help sheet, or just closes it", async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const u = mount(<HelpOverlay onPick={onPick} onClose={onClose} />, {
      section: "all",
      cols: 100,
      rows: 40,
    });
    await vi.waitFor(() => expect(u.frame()).toContain("Keyboard"));

    u.clickText("Default download folder");
    await vi.waitFor(() => expect(onPick).toHaveBeenCalledWith("o", "Navigate"));
    u.clickText("Copy magnet");
    await vi.waitFor(() => expect(onPick).toHaveBeenCalledWith("y", "Search"));
    expect(onClose).not.toHaveBeenCalled();

    // Downloads keys do something else on the results list, so they only close.
    u.clickText("Pause/resume");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    u.clickText("Keyboard");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    expect(onPick).toHaveBeenCalledTimes(2);
  });
});
