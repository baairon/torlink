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
      { keys: "x", label: "Pick files to exclude" },
      { keys: "s", label: "Sort results" },
      { keys: "z", label: "Hide dead torrents" },
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
      { keys: "x", label: "Change excluded files" },
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

// Re-pick which files a download in progress fetches (Downloads pane only).
const FILES: Hint = { keys: "x", label: "Files" };

const EXPORT: Hint = { keys: "e", label: "Export" };

export function footerHints(
  region: Region,
  section: Section,
  downloadFocus?: DownloadFocus | null,
  seedFocus?: SeedFocus | null,
  resultFocus?: ResultFocus | null,
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
  if (section === "seeding") {
    const label =
      seedFocus === "seeding" ? "Pause" : seedFocus === "missing" ? "Retry" : "Resume";
    return [{ keys: "p", label }, { keys: "c", label: "Remove from list" }, FOLDER, SWITCH, ALWAYS];
  }
  if (section === "downloads") {
    if (downloadFocus === "paused") {
      return [{ keys: "p", label: "Resume" }, { keys: "c", label: "Cancel" }, FILES, FOLDER, TORRENT, SWITCH, ALWAYS];
    }
    if (downloadFocus === "failed") {
      return [{ keys: "f", label: "Retry" }, { keys: "c", label: "Remove" }, FILES, FOLDER, TORRENT, SWITCH, ALWAYS];
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
    return [{ keys: "p", label: "Pause" }, { keys: "c", label: "Cancel" }, FILES, FOLDER, TORRENT, SWITCH, ALWAYS];
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
  ];
}
