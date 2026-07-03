import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "ink-testing-library";
import { DownloadFolderPrompt } from "./DownloadFolderPrompt";

const ENTER = "\r";
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ESC = "\x1b";

// Ink processes keypresses through the `scheduler` package rather than
// flushing the resulting state synchronously, so tests yield a tick between
// an input and whatever depends on its result (a re-render, a follow-up
// keystroke whose handling depends on updated state, etc).
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// A lone ESC byte is ambiguous (it may be the start of a multi-byte escape
// sequence), so Ink's input parser holds it for `pendingInputFlushDelayMilliseconds`
// (20ms) before treating it as a standalone Escape keypress. A plain tick()
// isn't enough here; wait past that window instead.
const awaitEscapeFlush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 25));

function renderPrompt(opts: { defaultDir?: string; recents?: string[] } = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <DownloadFolderPrompt
      width={60}
      defaultDir={opts.defaultDir ?? "/dl"}
      recents={opts.recents ?? ["/games"]}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  );
  return { ...utils, onSubmit, onCancel };
}

afterEach(() => {
  cleanup();
});

describe("DownloadFolderPrompt", () => {
  it("Enter immediately submits the default dir", async () => {
    const { stdin, onSubmit } = renderPrompt();
    stdin.write(ENTER);
    await tick();
    expect(onSubmit).toHaveBeenCalledWith("/dl");
  });

  it("Down into the recent list then Enter submits the picked recent dir", async () => {
    const { stdin, onSubmit } = renderPrompt({ defaultDir: "/dl", recents: ["/games"] });
    stdin.write(DOWN); // input row -> recent row 0 ("/dl", labeled default)
    await tick();
    stdin.write(DOWN); // recent row 0 -> recent row 1 ("/games")
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(onSubmit).toHaveBeenCalledWith("/games");
  });

  it("Up from the first recent row re-enables the input", async () => {
    const { stdin, onSubmit } = renderPrompt({ defaultDir: "/dl", recents: ["/games"] });
    stdin.write(DOWN); // input row -> recent row 0
    await tick();
    stdin.write(UP); // recent row 0 -> back to input row
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(onSubmit).toHaveBeenCalledWith("/dl");
  });

  it("Esc cancels", async () => {
    const { stdin, onCancel } = renderPrompt();
    stdin.write(ESC);
    await awaitEscapeFlush();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
