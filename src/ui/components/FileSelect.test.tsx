import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { FileSelect } from "./FileSelect";
import type { FileInfo } from "../../download/engine";
import { formatBytes } from "../../util/format";

const DOWN = "\x1b[B";

// Ink flushes state updates from a keypress asynchronously (via the
// `scheduler` package), so a second keystroke that depends on the first
// having already re-rendered needs a tick in between.
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const files: FileInfo[] = [
  { name: "movie.mkv", path: "movie.mkv", length: 1_500_000_000 },
  { name: "subs.srt", path: "subs.srt", length: 2048 },
  { name: "sample.mkv", path: "sample.mkv", length: 1024 },
];

describe("FileSelect", () => {
  it("toggles the file under the cursor (index 0) on space", () => {
    const onToggle = vi.fn();
    const { stdin } = render(
      <FileSelect
        files={files}
        deselected={new Set()}
        onToggle={onToggle}
        active
        focused
        width={40}
        height={5}
      />,
    );
    stdin.write(" ");
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(0);
  });

  it("moves the cursor down before toggling", async () => {
    const onToggle = vi.fn();
    const { stdin } = render(
      <FileSelect
        files={files}
        deselected={new Set()}
        onToggle={onToggle}
        active
        focused
        width={40}
        height={5}
      />,
    );
    stdin.write(DOWN);
    await tick();
    stdin.write(" ");
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(1);
  });

  it("does not call onToggle when inactive", () => {
    const onToggle = vi.fn();
    const { stdin } = render(
      <FileSelect
        files={files}
        deselected={new Set()}
        onToggle={onToggle}
        active={false}
        focused
        width={40}
        height={5}
      />,
    );
    stdin.write(" ");
    stdin.write(DOWN);
    stdin.write(" ");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("renders [x]/[ ] checkboxes, file names and sizes", () => {
    const { lastFrame } = render(
      <FileSelect
        files={files}
        deselected={new Set([1])}
        onToggle={vi.fn()}
        active
        focused
        width={40}
        height={5}
      />,
    );
    const frame = lastFrame() ?? "";
    const lines = frame.split("\n");

    expect(lines[0]).toContain("[x]");
    expect(lines[0]).toContain("movie.mkv");
    expect(lines[0]).toContain(formatBytes(1_500_000_000));

    expect(lines[1]).toContain("[ ]");
    expect(lines[1]).toContain("subs.srt");
    expect(lines[1]).toContain(formatBytes(2048));

    expect(lines[2]).toContain("[x]");
    expect(lines[2]).toContain("sample.mkv");
    expect(lines[2]).toContain(formatBytes(1024));
  });
});
