import type { DownloadFocus, Region, ResultFocus, Section, SeedFocus } from "./store";

export interface Hint {
  keys: string;
  label: string;
}

interface HelpGroup {
  title: string;
  hints: Hint[];
}

export const HELP_GROUPS: HelpGroup[] = [
  {
    title: "Navigate",
    hints: [
      { keys: "↑↓←→ / hjkl", label: "Navigate panes and lists" },
      { keys: "↵", label: "Open" },
      { keys: "tab", label: "Switch pane" },
      { keys: "esc", label: "Back" },
      { keys: "o", label: "Default download folder" },
      { keys: "t", label: "Extra trackers" },
      { keys: "q", label: "Quit" },
    ],
  },
  {
    title: "Search",
    hints: [
      { keys: "/", label: "Edit search" },
      { keys: "f", label: "Filter list" },
      { keys: "d", label: "Download (shift+d: folder)" },
      { keys: "s", label: "Sort results" },
      { keys: "z", label: "Hide dead torrents" },
      { keys: "i", label: "Toggle info pane" },
      // The pane's own two keys sit with the toggle that summons it, not up in Navigate: the
      // arrows there already describe walking panes, and these say what the third column is for.
      { keys: "→", label: "Focus info pane to scroll" },
      { keys: "←", label: "Back to the results list" },
      { keys: "y", label: "Copy magnet" },
      { keys: "↵", label: "Open details" },
      { keys: "e", label: "Export as .torrent" },
      { keys: "m", label: "Paste magnet" },
    ],
  },
  {
    title: "Downloads",
    hints: [
      { keys: "p", label: "Pause/resume" },
      { keys: "c", label: "Cancel or remove (shift+c: all)" },
      { keys: "f", label: "Retry failed" },
      { keys: "d", label: "Download again" },
      { keys: "e", label: "Open folder" },
      { keys: "s", label: "Export torrent file" },
    ],
  },
  {
    title: "Seeding",
    hints: [
      { keys: "p", label: "Pause/resume" },
      { keys: "c", label: "Remove (shift+c: all)" },
      { keys: "e", label: "Open folder" },
    ],
  },
];

// Footer labels stay terse so the contextual hint row never wraps; the `?`
// overlay (HELP_GROUPS) carries the full, descriptive list. Rare or
// self-announcing actions (z) stay `?`-only to keep every row inside 80 cols.
const NAVIGATE: Hint = { keys: "↑↓←→", label: "Move" };

const ALWAYS: Hint = { keys: "?", label: "Keys" };

const SWITCH: Hint = { keys: "tab", label: "Switch" };

const FOLDER: Hint = { keys: "e", label: "Folder" };

const TORRENT: Hint = { keys: "s", label: "Export" };

const EXPORT: Hint = { keys: "e", label: "Export" };

/**
 * `previewAvailable` gates the info-pane hint on the pane being able to exist at all, and
 * `previewOpen` decides which of its keys the one hint slot spends itself on.
 *
 * The results row is already 84 columns against a 78-column budget at 80 cols (a known overflow
 * this test suite exempts), and Footer truncates from the end — so an unconditional hint would
 * spend its columns advertising a pane the terminal is too narrow to ever show, on exactly the
 * rows that can least afford them. Gated, the hint only appears from 92 cols, which is where the
 * pane itself starts existing. That is also why the pane gets one slot and not two: `→` and `i`
 * are the same single column of hint, showing whichever one does something right now — with the
 * pane on screen that is stepping into it, with it toggled off that is bringing it back. The `?`
 * sheet carries all three keys unabbreviated. The defaults keep every existing caller —
 * scripts/render-previews-impl.tsx included — compiling and rendering unchanged.
 */
export function footerHints(
  region: Region,
  section: Section,
  downloadFocus?: DownloadFocus | null,
  seedFocus?: SeedFocus | null,
  resultFocus?: ResultFocus | null,
  previewAvailable = false,
  previewOpen = false,
): Hint[] {
  if (region === "sidebar") {
    return [
      NAVIGATE,
      { keys: "↵", label: "Open" },
      SWITCH,
      ALWAYS,
      { keys: "q", label: "Quit" },
    ];
  }
  // The third column reached from the results list, and the only place the list's own keys are
  // not what the user needs told: the pane scrolls, and the way back out is the way in reversed.
  if (region === "preview") {
    return [{ keys: "↑↓", label: "Scroll" }, { keys: "←", label: "Back" }, SWITCH, ALWAYS];
  }
  if (section === "seeding") {
    const label =
      seedFocus === "seeding" ? "Pause" : seedFocus === "missing" ? "Retry" : "Resume";
    return [{ keys: "p", label }, { keys: "c", label: "Remove from list" }, FOLDER, SWITCH, ALWAYS];
  }
  if (section === "downloads") {
    if (downloadFocus === "paused") {
      return [{ keys: "p", label: "Resume" }, { keys: "c", label: "Cancel" }, FOLDER, TORRENT, SWITCH, ALWAYS];
    }
    if (downloadFocus === "failed") {
      return [{ keys: "f", label: "Retry" }, { keys: "c", label: "Remove" }, FOLDER, TORRENT, SWITCH, ALWAYS];
    }
    if (downloadFocus === "recent") {
      // Removal is list bookkeeping, never file deletion, and the label says
      // so. Clear-all (shift+c) stays `?`-only, like D.
      return [
        { keys: "d", label: "Redownload" },
        { keys: "c", label: "Remove from list" },
        FOLDER,
        TORRENT,
        SWITCH,
        ALWAYS,
      ];
    }
    return [{ keys: "p", label: "Pause" }, { keys: "c", label: "Cancel" }, FOLDER, TORRENT, SWITCH, ALWAYS];
  }
  return [
    NAVIGATE,
    // The footer advertises only the default download key; D (download to a
    // chosen folder) stays bound but lives in the `?` sheet alone.
    { keys: "d", label: "Download" },
    { keys: "y", label: "Copy" },
    resultFocus === "detail" ? EXPORT : { keys: "s", label: "Sort" },
    { keys: "/", label: "Search" },
    { keys: "f", label: "Filter" },
    SWITCH,
    ALWAYS,
    // Last on purpose, behind the `?` anchor rather than in front of it. Footer truncates from the
    // end, and this row is 84 columns before the hint and 93 after it, so between 92 (where the
    // pane first exists) and 94 columns something has to go — and it must not be `? Keys`, which
    // is how every binding that does not fit here is discoverable at all. Both key glyphs are one
    // column wide, so which one is showing never moves that boundary.
    //
    // Games is excluded here rather than at the call site because it is the same rule the pane
    // itself follows: no provider answers for games, so the pane would be a column of "No
    // metadata" and the hint an invitation to open it.
    ...(previewAvailable && section !== "games"
      ? [{ keys: previewOpen ? "→" : "i", label: "Info" }]
      : []),
  ];
}
