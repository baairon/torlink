import { afterEach, describe, expect, it, vi } from "vitest";
import { renderUI, KEY, type RenderedUI } from "../testHarness";
import { FilePicker } from "./FilePicker";
import type { TorrentFileEntry } from "../../download/types";

const FILES: TorrentFileEntry[] = [
  { index: 0, name: "movie.mkv", length: 3e9 },
  { index: 1, name: "sample.mkv", length: 4e7 },
  { index: 2, name: "readme.txt", length: 2e3 },
];

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let ui: RenderedUI | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

function mount(): { onSubmit: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn> } {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  ui = renderUI(
    <FilePicker
      width={70}
      subject="Some Season Pack"
      files={FILES}
      listRows={10}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  );
  return { onSubmit, onCancel };
}

// Feed keys one at a time, letting ink's stdin parser and React settle between
// each — successive presses in one tick get coalesced and lost otherwise.
async function press(keys: string[]): Promise<void> {
  for (const k of keys) {
    ui!.press(k);
    await tick();
  }
}

describe("FilePicker", () => {
  it("keeps every file by default (enter submits an empty exclusion list)", async () => {
    const { onSubmit } = mount();
    await press([KEY.enter]);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith([]));
  });

  it("excludes the file under the cursor when toggled", async () => {
    const { onSubmit } = mount();
    await press([" ", KEY.enter]);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith([0]));
  });

  it("toggles the file the cursor moved to", async () => {
    const { onSubmit } = mount();
    await press(["j", "x", KEY.enter]);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith([1]));
  });

  it("refuses to submit when every file is excluded", async () => {
    const { onSubmit } = mount();
    await press(["a", KEY.enter]);
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("cancels on esc", async () => {
    const { onCancel } = mount();
    await press([KEY.esc]);
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
  });
});
