import { afterEach, describe, expect, it, vi } from "vitest";
import { Text, useInput } from "ink";
import { useEffect } from "react";
import { renderUI } from "./testHarness";
import { useStore } from "./store";
import { App } from "./App";

vi.mock("../config/config", () => ({
  loadConfig: async () => ({ downloadDir: "/tmp", trackers: [] }),
  saveConfig: async () => {},
}));
vi.mock("../download/queue", () => ({
  DownloadQueue: class {
    items: unknown[] = [];
    setTrackers() {}
    restore() {}
    restoreHistory() {}
    restoreSeeds() {}
    getItems() { return this.items; }
    getHistory() { return []; }
    getSeeds() { return []; }
    add(input: unknown) { this.items.push(input); }
    on() { return this; }
    off() { return this; }
    suspend() {}
  },
}));
vi.mock("../download/persist", () => ({ loadQueue: async () => [], loadSeeds: async () => [] }));
vi.mock("../download/history", () => ({ loadHistory: async () => [] }));
vi.mock("../download/reconcile", () => ({ reconcileQueue: (items: unknown[]) => items }));
vi.mock("../download/bootguard", () => ({
  BOOT_SETTLE_MS: 0,
  armBootMarker() {},
  disarmBootMarker() {},
  wasBootInterrupted: () => false,
}));
vi.mock("../util/crashlog", () => ({ logCrash() {} }));
vi.mock("../sources/magnet", () => ({ parseInput: () => null }));
vi.mock("../sources/torrentFile", () => ({ magnetFromTorrentFile: async () => null }));
vi.mock("../sources/torrentPath", () => ({ resolveTorrentPath: () => null }));
vi.mock("../util/clipboard", () => ({ readClipboard: async () => "", writeClipboard: async () => false }));
vi.mock("../util/openFolder", () => ({ openFolder: async () => false }));
vi.mock("../config/folder", () => ({ normalizeDownloadDir: (raw: string) => raw }));
vi.mock("../update/version", () => ({ fetchLatestVersion: async () => null, isNewer: () => false }));
vi.mock("./hooks/useMouseWheel", () => ({ useMouseWheel() {} }));

vi.mock("./views/Splash", () => ({
  Splash: () => {
    const { submitQuery } = useStore();
    useEffect(() => submitQuery("search"), [submitQuery]);
    return <Text>splash</Text>;
  },
}));
vi.mock("./components/Results", () => ({
  Results: () => {
    const store = useStore();
    useInput((input) => {
      if (input === "d") {
        store.startDownload({ id: "hash", name: "test release", magnet: "magnet:?xt=urn:btih:hash" });
      } else if (input === "f") {
        store.requestDownloadTo([{ id: "hash", name: "test release", magnet: "magnet:?xt=urn:btih:hash" }]);
      }
    });
    return <Text>{`selected-pane:${store.section} region:${store.region}`}</Text>;
  },
}));
vi.mock("./components/Logo", () => ({ Logo: () => null }));
vi.mock("./components/Sidebar", () => ({ Sidebar: () => null, RAIL_WIDTH: 20 }));
vi.mock("./components/Rule", () => ({ Rule: () => null }));
vi.mock("./components/Footer", () => ({ Footer: () => null }));
vi.mock("./components/HelpOverlay", () => ({ HelpOverlay: () => null }));
vi.mock("./components/Downloads", () => ({ Downloads: () => null }));
vi.mock("./components/Seeding", () => ({ Seeding: () => null }));
vi.mock("./components/Spinner", () => ({ Spinner: () => null }));
vi.mock("./components/TabTitle", () => ({ TabTitle: () => null }));
vi.mock("./components/FolderPrompt", () => ({
  FolderPrompt: ({ onSubmit }: { onSubmit: (path: string) => void }) => {
    useInput((input) => {
      if (input === "p") onSubmit("/tmp");
    });
    return <Text>folder-prompt</Text>;
  },
}));
vi.mock("./components/TrackersPrompt", () => ({ TrackersPrompt: () => null }));

describe("App queueing navigation", () => {
  let unmount: (() => void) | undefined;

  afterEach(() => {
    unmount?.();
    unmount = undefined;
  });

  it("keeps the selected pane and focus after adding a download", async () => {
    const ui = renderUI(<App />);
    unmount = ui.unmount;

    await vi.waitFor(() => expect(ui.frame()).toContain("selected-pane:all region:content"));
    ui.press("\t");
    await vi.waitFor(() => expect(ui.frame()).toContain("selected-pane:all region:sidebar"));
    ui.press("d");
    await vi.waitFor(() => expect(ui.frame()).toContain("selected-pane:all region:sidebar"));
  });

  it("keeps the selected pane and focus after queueing into another folder", async () => {
    const ui = renderUI(<App />);
    unmount = ui.unmount;

    await vi.waitFor(() => expect(ui.frame()).toContain("selected-pane:all region:content"));
    ui.press("\t");
    await vi.waitFor(() => expect(ui.frame()).toContain("selected-pane:all region:sidebar"));
    ui.press("f");
    await vi.waitFor(() => expect(ui.frame()).toContain("folder-prompt"));
    ui.press("p");
    await vi.waitFor(() => expect(ui.frame()).toContain("selected-pane:all region:sidebar"));
  });
});
