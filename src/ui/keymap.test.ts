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
    // Both halves of the trip are documented, or the pane is a room with no marked exit.
    expect(search?.hints.find((h) => h.keys === "→")?.label).toContain("info pane");
    expect(search?.hints.find((h) => h.keys === "←")?.label).toContain("results list");
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

  it("spends its one slot on the key that does something right now", () => {
    // Pane on screen: → steps into it. Pane toggled off: i is what brings it back. Two hints for
    // one pane would cost the row columns it does not have, and one arrow glyph is exactly as
    // wide as the "i" it replaces, so the 93-column boundary above never moves.
    const open = footerHints("content", "movies", null, null, null, true, true);
    expect(open.find((h) => h.label === "Info")?.keys).toBe("→");
    expect(rowWidth(open)).toBe(93);
    const closed = footerHints("content", "movies", null, null, null, true, false);
    expect(closed.find((h) => h.label === "Info")?.keys).toBe("i");
    expect(rowWidth(closed)).toBe(93);
  });

  it("says nothing about a pane the Games tab never shows", () => {
    // No provider answers for games, so the pane is hidden there and an "Info" hint would be an
    // invitation to open a column that cannot exist.
    for (const open of [true, false]) {
      const games = footerHints("content", "games", null, null, null, true, open);
      expect(games.some((h) => h.label === "Info")).toBe(false);
    }
    expect(footerHints("content", "anime", null, null, null, true).some((h) => h.label === "Info"))
      .toBe(true);
  });
});

describe("focused info pane footer", () => {
  it("swaps the list's vocabulary for the pane's, and keeps the ? anchor last", () => {
    const row = footerHints("preview", "all", null, null, null, true, true);
    expect(row.map((h) => h.keys)).toEqual(["↑↓", "←", "tab", "?"]);
    expect(row.at(-1)?.label).toBe("Keys");
    // The list's own keys are gone, because in this region they are not what the keyboard does.
    for (const gone of ["d", "y", "/", "f", "s"]) {
      expect(row.some((h) => h.keys === gone), gone).toBe(false);
    }
  });

  it("fits the 80-column budget, even though it only ever appears above 92", () => {
    expect(rowWidth(footerHints("preview", "all", null, null, null, true, true))).toBeLessThanOrEqual(78);
  });

  it("answers the region before the section, since the pane is only ever the results view's", () => {
    // Downloads and Seeding never report this region; if one somehow did, the pane's row is still
    // the correct answer for a keyboard that is inside the pane.
    for (const section of ["all", "movies", "downloads", "seeding"] as const) {
      expect(footerHints("preview", section, "recent", "seeding").map((h) => h.keys)).toEqual([
        "↑↓",
        "←",
        "tab",
        "?",
      ]);
    }
  });
});
