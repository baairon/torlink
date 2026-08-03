import { afterEach, describe, expect, it, vi } from "vitest";
import { StoreContext } from "../store";
import { fakeQueue, makeTestStore, renderUI, type RenderedUI } from "../testHarness";
import { Downloads } from "./Downloads";
import type { QueueItem } from "../../download/types";
import type { HistoryItem } from "../../download/history";

const NOW_MS = 1_760_000_000_000;

const activeItem = (id: string, name: string): QueueItem => ({
  id,
  name,
  source: "yts",
  magnet: `magnet:?xt=urn:btih:${id}`,
  dir: "C:/dl",
  status: "downloading",
  progress: 40,
  totalBytes: 2e9,
  downloadedBytes: 8e8,
  speed: 5e6,
  peers: 12,
  eta: 240,
  addedAt: NOW_MS,
});

const recentItem = (id: string, name: string): HistoryItem => ({
  id,
  name,
  source: "eztv",
  sizeBytes: 1.5e9,
  magnet: `magnet:?xt=urn:btih:${id}`,
  dir: "C:/dl",
  completedAt: NOW_MS,
});

const ACTIVE = [activeItem("q1", "fedora workstation 42 iso")];
const RECENT = [
  recentItem("h1", "ubuntu 24.04 desktop iso"),
  recentItem("h2", "debian 12 netinst iso"),
  recentItem("h3", "arch linux 2026.07 iso"),
];

let ui: RenderedUI | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

function mount(items: QueueItem[] = ACTIVE, history: HistoryItem[] = RECENT): RenderedUI {
  ui = renderUI(
    <StoreContext.Provider
      value={makeTestStore({ queue: fakeQueue(items, history), section: "downloads" })}
    >
      <Downloads />
    </StoreContext.Provider>,
  );
  return ui;
}

const lineWith = (u: RenderedUI, needle: string): string =>
  u.frame().split("\n").find((l) => l.includes(needle)) ?? "";

// Two immediate press() calls can coalesce into one input chunk, which Ink
// delivers as a single unmatched keypress; settle between no-op keys instead.
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 25));

describe("Downloads clear/remove keys", () => {
  it("c removes only the selected recent entry", async () => {
    const u = mount();
    await vi.waitFor(() => expect(u.frame()).toContain("Recently downloaded  (3)"));
    u.press("j");
    await vi.waitFor(() => expect(lineWith(u, "ubuntu 24.04")).toContain("❯"));

    u.press("c");
    await vi.waitFor(() => expect(u.frame()).toContain("Recently downloaded  (2)"));
    expect(u.frame()).not.toContain("ubuntu 24.04");
    expect(u.frame()).toContain("debian 12");
    expect(u.frame()).toContain("arch linux");
  });

  it("shift+c clears all recent entries from recent focus", async () => {
    const u = mount();
    await vi.waitFor(() => expect(u.frame()).toContain("Recently downloaded  (3)"));
    u.press("j");
    await vi.waitFor(() => expect(lineWith(u, "ubuntu 24.04")).toContain("❯"));

    u.press("C");
    await vi.waitFor(() => expect(u.frame()).not.toContain("Recently downloaded"));
    expect(u.frame()).toContain("fedora workstation");
    expect(u.frame()).not.toContain("ubuntu 24.04");
  });

  it("shift+c does nothing while an active download is focused", async () => {
    const u = mount();
    await vi.waitFor(() => expect(u.frame()).toContain("Recently downloaded  (3)"));

    u.press("C");
    await tick();
    u.press("x");
    await tick();
    // Navigation still works afterwards, and the history is untouched.
    u.press("j");
    await vi.waitFor(() => expect(lineWith(u, "ubuntu 24.04")).toContain("❯"));
    expect(u.frame()).toContain("Recently downloaded  (3)");
  });

  it("x is no longer bound anywhere in the panel", async () => {
    const u = mount();
    await vi.waitFor(() => expect(u.frame()).toContain("Recently downloaded  (3)"));
    u.press("j");
    await vi.waitFor(() => expect(lineWith(u, "ubuntu 24.04")).toContain("❯"));

    u.press("x");
    await tick();
    u.press("j");
    await vi.waitFor(() => expect(lineWith(u, "debian 12")).toContain("❯"));
    expect(u.frame()).toContain("Recently downloaded  (3)");
  });
});

describe("Downloads queued rows", () => {
  it("renders a waiting item as queued, not failed", async () => {
    const queued: QueueItem = {
      ...activeItem("q2", "kubuntu 25.10 iso"),
      status: "queued",
      progress: 0,
      downloadedBytes: 0,
      speed: 0,
      peers: 0,
      eta: undefined,
    };
    const u = mount([queued], []);
    await vi.waitFor(() => expect(u.frame()).toContain("kubuntu 25.10"));
    expect(u.frame()).toContain("queued  0%");
    expect(u.frame()).not.toContain("failed");
    expect(lineWith(u, "kubuntu 25.10")).toContain("·");
  });
});
