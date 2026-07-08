import type { DownloadFocus, Region, Section, SeedFocus } from "./store";

export interface Hint {
  keys: string;
  label: string;
  color?: string;
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
      { keys: "b", label: "Turtle Mode (Throttle)" },
      { keys: "q", label: "Quit" },
    ],
  },
  {
    title: "Search",
    hints: [
      { keys: "/", label: "Edit search" },
      { keys: "d", label: "Download (shift+d picks folder)" },
      { keys: "s", label: "Sort results" },
      { keys: "z", label: "Hide dead torrents" },
      { keys: "i", label: "Inspect files" },
      { keys: "y", label: "Copy magnet" },
      { keys: "m", label: "Paste magnet" },
    ],
  },
  {
    title: "Downloads",
    hints: [
      { keys: "p", label: "Pause/resume" },
      { keys: "c", label: "Cancel or remove" },
      { keys: "f", label: "Retry failed" },
      { keys: "d", label: "Download again" },
      { keys: "e", label: "Open folder" },
      { keys: "v", label: "Stream video" },
      { keys: "i", label: "Inspect files" },
      { keys: "s", label: "Export torrent file" },
      { keys: "x", label: "Clear recent" },
    ],
  },
  {
    title: "Seeding",
    hints: [
      { keys: "p", label: "Pause/resume" },
      { keys: "c", label: "Remove from list" },
      { keys: "e", label: "Open folder" },
    ],
  },
  {
    title: "Files",
    hints: [
      { keys: "space", label: "Keep or skip file" },
      { keys: "↵", label: "Open file natively" },
      { keys: "v", label: "Stream video" },
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

const STREAM: Hint = { keys: "v", label: "Stream" };

const TORRENT: Hint = { keys: "s", label: "Export" };

export function footerHints(
  region: Region,
  section: Section,
  throttleEnabled: boolean,
  inspectingPeersId?: string | null,
  downloadFocus?: DownloadFocus | null,
  seedFocus?: SeedFocus | null,
  inspecting?: boolean,
  inspectFocusSelected?: boolean
): Hint[] {
  const getHints = (): Hint[] => {
    if (inspecting) {
      const spaceLabel = inspectFocusSelected ? "Skip" : "Keep";
      const spaceColor = inspectFocusSelected ? "red" : "green";
      return [
        { keys: "↑↓", label: "Move" },
        { keys: "space", label: spaceLabel, color: spaceColor },
        { keys: "↵", label: "Open" },
        STREAM,
        { keys: "esc", label: "Back" },
        ALWAYS,
      ];
    }
    if (inspectingPeersId) {
      return [
        { keys: "s", label: "Sort" },
        { keys: "w", label: "Close" },
        { keys: "esc", label: "Back" },
        SWITCH,
        ALWAYS,
      ];
    }
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
      return [{ keys: "p", label }, { keys: "c", label: "Remove" }, FOLDER, SWITCH, ALWAYS];
    }
    if (section === "downloads") {
      if (downloadFocus === "paused") {
        return [{ keys: "i", label: "Files" }, { keys: "p", label: "Resume" }, { keys: "c", label: "Cancel" }, STREAM, FOLDER, TORRENT, SWITCH, ALWAYS];
      }
      if (downloadFocus === "failed") {
        return [{ keys: "i", label: "Files" }, { keys: "f", label: "Retry" }, { keys: "c", label: "Remove" }, FOLDER, TORRENT, SWITCH, ALWAYS];
      }
      if (downloadFocus === "recent") {
        return [
          { keys: "d", label: "Redownload" },
          { keys: "c", label: "Remove" },
          { keys: "x", label: "Clear" },
          FOLDER,
          TORRENT,
          SWITCH,
          ALWAYS,
        ];
      }
      if (downloadFocus === "downloading") {
        return [
          { keys: "i", label: "Files" },
          { keys: "p", label: "Pause" },
          { keys: "c", label: "Cancel" },
          STREAM,
          FOLDER,
          TORRENT,
          SWITCH,
          ALWAYS,
        ];
      }
      return [{ keys: "p", label: "Pause" }, { keys: "c", label: "Cancel" }, STREAM, FOLDER, TORRENT, SWITCH, ALWAYS];
    }
    return [
      NAVIGATE,
      { keys: "d", label: "Download" },
      { keys: "i", label: "Files" },
      { keys: "y", label: "Copy" },
      { keys: "s", label: "Sort" },
      { keys: "/", label: "Search" },
      SWITCH,
      ALWAYS,
    ];
  };

  const hints = getHints();
  
  if (!inspectingPeersId && !inspecting && region === "content" && (section === "downloads" || section === "seeding")) {
    const focusExists = section === "downloads" ? !!downloadFocus : !!seedFocus;
    if (focusExists) {
      const peerHint: Hint = { keys: "w", label: "Peers" };
      const switchIdx = hints.findIndex((h) => h.keys === "tab");
      if (switchIdx >= 0) hints.splice(switchIdx, 0, peerHint);
      else hints.push(peerHint);
    }
  }

  const throttleHint: Hint = throttleEnabled
    ? { keys: "b", label: "Full Speed", color: "green" }
    : { keys: "b", label: "Turtle", color: "red" };

  const switchIdx = hints.findIndex((h) => h.keys === "tab");
  if (switchIdx >= 0) {
    hints.splice(switchIdx, 0, throttleHint);
  } else {
    hints.push(throttleHint);
  }

  return hints;
}
