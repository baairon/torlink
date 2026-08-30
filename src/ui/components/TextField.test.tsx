import { describe, it, expect, vi } from "vitest";
import { renderUI } from "../testHarness";
import { TextField, deleteAt, deleteWordAfter, wordLeft, wordRight } from "./TextField";

describe("wordLeft", () => {
  it("jumps to the start of the previous word, crossing runs of spaces", () => {
    expect(wordLeft("one two", 7)).toBe(4);
    expect(wordLeft("one two", 4)).toBe(0);
    expect(wordLeft("one   two", 6)).toBe(0);
    expect(wordLeft("one two", 5)).toBe(4);
  });

  it("stays put at the start of the line", () => {
    expect(wordLeft("one", 0)).toBe(0);
    expect(wordLeft("", 0)).toBe(0);
  });
});

describe("wordRight", () => {
  it("jumps past the end of the next word, crossing runs of spaces", () => {
    expect(wordRight("one two", 0)).toBe(3);
    expect(wordRight("one two", 3)).toBe(7);
    expect(wordRight("one   two", 3)).toBe(9);
    expect(wordRight("one two", 5)).toBe(7);
  });

  it("stays put at the end of the line", () => {
    expect(wordRight("one", 3)).toBe(3);
    expect(wordRight("", 0)).toBe(0);
  });
});

describe("deleteWordAfter", () => {
  it("removes through the end of the next word, keeping the cursor in place", () => {
    expect(deleteWordAfter("one two", 3)).toEqual({ value: "one", cursor: 3 });
    expect(deleteWordAfter("one two three", 4)).toEqual({ value: "one  three", cursor: 4 });
    expect(deleteWordAfter("one   two", 3)).toEqual({ value: "one", cursor: 3 });
  });

  it("no-ops at the end of the line", () => {
    expect(deleteWordAfter("one", 3)).toEqual({ value: "one", cursor: 3 });
    expect(deleteWordAfter("", 0)).toEqual({ value: "", cursor: 0 });
  });
});

describe("deleteAt", () => {
  it("removes the character under the cursor without moving it", () => {
    expect(deleteAt("abc", 0)).toEqual({ value: "bc", cursor: 0 });
    expect(deleteAt("abc", 1)).toEqual({ value: "ac", cursor: 1 });
  });

  it("no-ops at the end of the line", () => {
    expect(deleteAt("abc", 3)).toEqual({ value: "abc", cursor: 3 });
    expect(deleteAt("", 0)).toEqual({ value: "", cursor: 0 });
  });
});

// Ink cannot name a device-attributes report as a key, so use-input falls back to handing the raw
// sequence to every handler as if it had been typed. The startup graphics probe asks the terminal
// for one as a fence and consumes it, but a terminal slow enough to answer after the probe gave up
// still lands its report here.
const DA1 = "\u001b[?62;22;52c";

/** One turn of the loop, so the next press arrives as a separate read the way a terminal sends it. */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

describe("what the field refuses to type", () => {
  it("drops a device-attributes report that arrives without its ESC", async () => {
    // Ink often delivers the ESC in the chunk before the rest, which is why the pattern makes it
    // optional — the same reason the SGR-mouse pattern beside it does.
    const ui = renderUI(<TextField placeholder="Search" />);
    try {
      ui.press(DA1.slice(1) + "ubuntu");
      await vi.waitFor(() => expect(ui.frame()).toContain("ubuntu"));
      expect(ui.frame()).not.toContain("62;22;52");
    } finally {
      ui.unmount();
    }
  });

  it("drops a device-attributes report that arrives in its own read", async () => {
    // Ink strips the ESC before useInput ever sees the string, so this hits the same optional-ESC
    // branch as the test above — the distinct shape here is the read boundary, not the ESC. This is
    // still worth pinning: it is the delivery a report shows up as when it arrives on its own,
    // after the probe has already given up on the reply.
    const ui = renderUI(<TextField placeholder="Search" />);
    try {
      ui.press(DA1);
      await settle();
      ui.press("ubuntu");
      await vi.waitFor(() => expect(ui.frame()).toContain("ubuntu"));
      expect(ui.frame()).not.toContain("62;22;52");
    } finally {
      ui.unmount();
    }
  });
});
