import { describe, expect, it } from "vitest";
import { footerHints, HELP_GROUPS, type Hint } from "./keymap";

// Footer.tsx renders hints as "keys label" joined by a 3-space separator, and
// the app pads one column each side, so a row must fit 80 - 2 at 80 cols.
const rowWidth = (hints: Hint[]): number =>
  hints.reduce((n, h) => n + h.keys.length + 1 + h.label.length, 0) + (hints.length - 1) * 3;

// The same row as a string, so a test can ask what survives Footer's `wrap="truncate-end"` at a
// given terminal width instead of only asking how wide the untruncated row would have been.
const rowText = (hints: Hint[]): string => hints.map((h) => `${h.keys} ${h.label}`).join("   ");

describe("downloads/seeding key vocabulary", () => {
  it("folds clear-all into shift+c on the c row and drops x", () => {
    const downloads = HELP_GROUPS.find((g) => g.title === "Downloads")!;
    expect(downloads.hints.some((h) => h.keys === "x")).toBe(false);
    expect(downloads.hints.some((h) => h.keys === "shift+c")).toBe(false);
    expect(downloads.hints.find((h) => h.keys === "c")?.label).toContain("(shift+c");
  });

  it("labels one-entry removal as list bookkeeping in the footers", () => {
    const recent = footerHints("content", "downloads", "recent", null);
    expect(recent.some((h) => h.keys === "x")).toBe(false);
    expect(recent.find((h) => h.keys === "c")?.label).toBe("Remove from list");

    const seeding = footerHints("content", "seeding", null, "seeding");
    expect(seeding.find((h) => h.keys === "c")?.label).toBe("Remove from list");
  });

  // The results row carries a known pre-existing overflow (f Filter), so the
  // budget is pinned only for the rows this vocabulary owns.
  it("keeps the downloads and seeding footer rows inside the 80-col budget", () => {
    const rows = [
      footerHints("sidebar", "downloads", null, null),
      footerHints("content", "downloads", "downloading", null),
      footerHints("content", "downloads", "paused", null),
      footerHints("content", "downloads", "failed", null),
      footerHints("content", "downloads", "recent", null),
      footerHints("content", "seeding", null, "seeding"),
      footerHints("content", "seeding", null, "missing"),
      footerHints("content", "seeding", null, null),
    ];
    for (const row of rows) expect(rowWidth(row)).toBeLessThanOrEqual(78);
  });
});

describe("info pane key", () => {
  it("carries the full label in the ? sheet", () => {
    const search = HELP_GROUPS.find((g) => g.title === "Search");
    expect(search?.hints.find((h) => h.keys === "i")?.label).toBe("Toggle info pane");
  });

  it("advertises i in the footer only where the pane can exist", () => {
    expect(footerHints("content", "all", null, null, null).some((h) => h.keys === "i")).toBe(false);
    expect(footerHints("content", "all", null, null, null, true).find((h) => h.keys === "i")?.label).toBe(
      "Info",
    );
    // The pane belongs to the results view alone; no other row grows, whatever it is passed.
    const elsewhere = [
      footerHints("sidebar", "all", null, null, null, true),
      footerHints("content", "downloads", "downloading", null, null, true),
      footerHints("content", "seeding", null, "seeding", null, true),
    ];
    for (const row of elsewhere) expect(row.some((h) => h.keys === "i")).toBe(false);
  });

  // Footer truncates from the end, so the hint's position decides what a narrow terminal loses.
  // The pane appears from 92 cols (contentWidth 73), where the footer's budget is cols - 2 = 90
  // and this row measures 93 — the hint cannot fit there, and the point of putting it last is
  // that what does not fit is the hint itself and never the `? Keys` anchor.
  it("never pushes ? Keys off the row at any width where the hint appears", () => {
    const row = footerHints("content", "all", null, null, null, true);
    expect(rowWidth(row)).toBe(93);
    for (const cols of [92, 93, 94, 95, 120]) {
      expect(rowText(row).slice(0, cols - 2), `at ${cols} cols`).toContain("? Keys");
    }
    // And the row is unchanged, to the column, wherever the pane cannot render.
    expect(rowWidth(footerHints("content", "all", null, null, null))).toBe(84);
  });
});
