import { describe, expect, it, vi } from "vitest";
import { StoreContext } from "../store";
import { KEY, makeTestStore, renderUI } from "../testHarness";
import { MAX_DOWNLOAD_CHOICES, type Config } from "../../config/config";
import { Settings } from "./Settings";

// Ink only reads these as arrows with the ESC byte in front; a bare "[C"
// arrives as the two characters it looks like.
const RIGHT = `${KEY.esc}[C`;
const LEFT = `${KEY.esc}[D`;

// The smallest listRows that shows all nine rows at once. Below it the pane
// scrolls, which is correct behaviour but would make the "lists every setting"
// assertion depend on where the cursor is.
const FULL_PANE_ROWS = 11;

function mount(overrides: Partial<Config> = {}, extra: Record<string, unknown> = {}) {
  const onConfig = vi.fn();
  const base = makeTestStore({ listRows: FULL_PANE_ROWS });
  const store = {
    ...base,
    config: {
      downloadDir: "~/Downloads/torlink",
      trackers: [],
      maxDownloads: 0,
      checkForUpdates: true,
      ...overrides,
    } as Config,
    setConfig: onConfig,
    ...extra,
  } as typeof base;
  const ui = renderUI(
    <StoreContext.Provider value={store}>
      <Settings />
    </StoreContext.Provider>,
    { rows: 24 },
  );
  return { ui, onConfig };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

// One keypress, then a frame. Two writes inside a single tick reach the same
// render, and the second would read a cursor the first already moved.
async function press(ui: { press: (b: string) => void }, ...keys: string[]): Promise<void> {
  for (const k of keys) {
    ui.press(k);
    await tick();
  }
}

describe("settings pane", () => {
  it("lists every setting under its group", async () => {
    const { ui } = mount();
    await tick();
    const frame = ui.frame();
    for (const label of [
      "Downloads",
      "Folder",
      "At once",
      "Network",
      "Trackers",
      "Application",
      "Update check",
    ]) {
      expect(frame, label).toContain(label);
    }
    ui.unmount();
  });

  it("steps the concurrency cap with the arrows, and saves it", async () => {
    const { ui, onConfig } = mount({ maxDownloads: 0 });
    await press(ui, "j", RIGHT); // past Folder, onto At once
    expect(onConfig).toHaveBeenCalledTimes(1);
    expect(onConfig.mock.calls[0]![0].maxDownloads).toBe(MAX_DOWNLOAD_CHOICES[1]);
    ui.unmount();
  });

  it("wraps around the ends of a choice list rather than stopping", async () => {
    // Unlimited is the first choice, so stepping back lands on the last one.
    const { ui, onConfig } = mount({ maxDownloads: 0 });
    await press(ui, "j", LEFT);
    expect(onConfig.mock.calls[0]![0].maxDownloads).toBe(
      MAX_DOWNLOAD_CHOICES[MAX_DOWNLOAD_CHOICES.length - 1],
    );
    ui.unmount();
  });

  it("skips headings and blank lines when the cursor moves", async () => {
    // Four value rows over nine lines. Stepping down four times has to wrap
    // back to the first one rather than parking on a heading or a spacer.
    const openFolderPrompt = vi.fn();
    const { ui, onConfig } = mount({}, { openFolderPrompt });
    await press(ui, "j", "j", "j", "j", KEY.enter);
    expect(openFolderPrompt).toHaveBeenCalledTimes(1);
    // Folder is a prompt, so nothing was saved on the way round.
    expect(onConfig).not.toHaveBeenCalled();
    ui.unmount();
  });

  it("shows 0 as the word, so there is one way to say no ceiling", async () => {
    const { ui } = mount({ maxDownloads: 0 });
    await tick();
    expect(ui.frame()).toContain("unlimited");
    ui.unmount();
  });

  it("toggles the update check", async () => {
    const { ui, onConfig } = mount({ checkForUpdates: true });
    await press(ui, "j", "j", "j", RIGHT);
    expect(onConfig).toHaveBeenCalledTimes(1);
    expect(onConfig.mock.calls[0]![0].checkForUpdates).toBe(false);
    ui.unmount();
  });

  it("opens the shared folder and tracker prompts rather than its own copies", async () => {
    const openFolderPrompt = vi.fn();
    const openTrackersPrompt = vi.fn();
    const { ui } = mount({}, { openFolderPrompt, openTrackersPrompt });
    await press(ui, KEY.enter); // Folder is the first stop
    expect(openFolderPrompt).toHaveBeenCalledTimes(1);
    await press(ui, "j", "j", KEY.enter); // Trackers
    expect(openTrackersPrompt).toHaveBeenCalledTimes(1);
    ui.unmount();
  });

  it("summarises saved trackers by count rather than listing them", async () => {
    const { ui } = mount({ trackers: ["udp://a:1337/announce", "udp://b:1337/announce"] });
    await tick();
    expect(ui.frame()).toContain("2 trackers");
    ui.unmount();
  });

  it("says so when no trackers are saved", async () => {
    const { ui } = mount({ trackers: [] });
    await tick();
    expect(ui.frame()).toContain("none saved");
    ui.unmount();
  });

  it("scrolls instead of crushing rows when the terminal is short", async () => {
    // Five rows for nine rows of content: the window has to move, and the rows
    // it does show have to keep their own lines.
    const { ui } = mount({}, { listRows: 5 });
    await tick();
    expect(ui.frame()).toContain("Folder");
    // Nothing from the last group can be on screen at this height.
    expect(ui.frame()).not.toContain("Update check");
    ui.unmount();
  });
});
