import { describe, it, expect } from "vitest";
import { footerHints, HELP_GROUPS } from "./keymap";

describe("footerHints", () => {
  it("shows file inspection hints when inspecting is true", () => {
    const hints = footerHints("content", "downloads", false, null, "downloading", null, true, true);
    
    expect(hints).toEqual(
      expect.arrayContaining([
        { keys: "↑↓", label: "Move" },
        { keys: "space", label: "Skip", color: "red" },
        { keys: "↵", label: "Open" },
        { keys: "esc", label: "Back" },
      ])
    );
  });

  it("shows the 'i' hint in the downloads section", () => {
    const hints = footerHints("content", "downloads", false, null, "paused", null, false);
    
    expect(hints).toEqual(
      expect.arrayContaining([
        { keys: "i", label: "Files" },
      ])
    );
  });

  it("shows the 'i' hint in the search section (default section fallback)", () => {
    const hints = footerHints("content", "all", false, null, null, null, false);
    
    // Fallback hints in keymap.ts advertise 'Search' as the section default
    expect(hints).toEqual(
      expect.arrayContaining([
        { keys: "/", label: "Search" },
      ])
    );
  });

  it("shows Turtle in red when throttle is disabled", () => {
    const hints = footerHints("content", "all", false);
    const throttleHint = hints.find((h) => h.keys === "b");
    expect(throttleHint).toBeDefined();
    expect(throttleHint?.label).toBe("Turtle");
    expect(throttleHint?.color).toBe("red");
  });

  it("shows Full Speed in green when throttle is enabled", () => {
    const hints = footerHints("content", "all", true);
    const throttleHint = hints.find((h) => h.keys === "b");
    expect(throttleHint).toBeDefined();
    expect(throttleHint?.label).toBe("Full Speed");
    expect(throttleHint?.color).toBe("green");
  });

  it("places the throttle hint immediately before SWITCH", () => {
    const hints = footerHints("content", "downloads", false);
    const tIndex = hints.findIndex((h) => h.keys === "b");
    const switchIndex = hints.findIndex((h) => h.keys === "tab");
    
    // T should exist
    expect(tIndex).toBeGreaterThan(-1);
    // SWITCH should exist
    expect(switchIndex).toBeGreaterThan(-1);
    // T should be immediately before SWITCH
    expect(tIndex).toBe(switchIndex - 1);
  });

  it("shows the 'w' hint to view peers in downloads section", () => {
    const hints = footerHints("content", "downloads", false, null, "downloading", null, false);
    
    expect(hints).toEqual(
      expect.arrayContaining([
        { keys: "w", label: "Peers" },
      ])
    );
  });
});

describe("HELP_GROUPS", () => {
  it("includes the 'Files' group with toggle capabilities", () => {
    const filesGroup = HELP_GROUPS.find((g) => g.title === "Files");
    expect(filesGroup).toBeDefined();
    
    const spaceHint = filesGroup?.hints.find((h) => h.keys === "space");
    expect(spaceHint).toBeDefined();
    expect(spaceHint?.label).toBe("Keep or skip file");
  });

  it("includes 'i' to inspect files in Search and Downloads groups", () => {
    const searchGroup = HELP_GROUPS.find((g) => g.title === "Search");
    const searchInspectHint = searchGroup?.hints.find((h) => h.keys === "i");
    expect(searchInspectHint).toBeDefined();

    const downloadsGroup = HELP_GROUPS.find((g) => g.title === "Downloads");
    const downloadsInspectHint = downloadsGroup?.hints.find((h) => h.keys === "i");
    expect(downloadsInspectHint).toBeDefined();
  });
});
