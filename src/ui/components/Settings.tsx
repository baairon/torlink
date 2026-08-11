import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Panel } from "./Panel";
import { MAX_DOWNLOAD_CHOICES } from "../../config/config";
import { truncate } from "../../util/format";
import { useStore } from "../store";
import { windowStart, wrapStep } from "../move";
import { COLOR, ICON } from "../theme";

// A row is either a value the arrow keys cycle through, or a text field that
// opens as a prompt. Group headings and the blank line between groups are
// rendered from the same list so the cursor maths only has to walk one array.
//
// The blank line is a row of its own rather than a margin on the heading: the
// panel window is sized in rows, and a margin is a row the window does not
// count. Four settings under three headings would then ask for more rows than
// the window hands out, and Yoga crushes the overflow rather than scrolling it.
type Row =
  | { kind: "spacer" }
  | { kind: "heading"; label: string }
  | {
      kind: "choice";
      label: string;
      value: string;
      /** Moves the setting by ±1 through its own list of values. */
      step: (delta: number) => void;
    }
  | { kind: "prompt"; label: string; value: string; open: () => void };

// The rows the cursor can land on: everything that carries a value.
type ValueRow = Extract<Row, { kind: "choice" | "prompt" }>;
const selectable = (r: Row): r is ValueRow => r.kind === "choice" || r.kind === "prompt";

export function Settings() {
  const {
    config,
    setConfig,
    region,
    contentWidth,
    listRows,
    setCaptureMode,
    openFolderPrompt,
    openTrackersPrompt,
  } = useStore();
  const focused = region === "content";

  // ←/→ belong to this pane while it has focus, or the app would read them as
  // "jump to the sidebar" and every value change would also move the cursor.
  useEffect(() => {
    if (!focused) return;
    setCaptureMode("lateral");
    return () => setCaptureMode("none");
  }, [focused, setCaptureMode]);

  const cycle = <T,>(values: readonly T[], current: T, delta: number): T =>
    values[wrapStep(Math.max(0, values.indexOf(current)), delta, values.length)]!;

  const rows: Row[] = [
    { kind: "heading", label: "Downloads" },
    {
      kind: "prompt",
      label: "Folder",
      value: config.downloadDir,
      open: openFolderPrompt,
    },
    {
      kind: "choice",
      label: "At once",
      value: config.maxDownloads === 0 ? "unlimited" : String(config.maxDownloads),
      step: (d) =>
        setConfig({
          ...config,
          maxDownloads: cycle(MAX_DOWNLOAD_CHOICES, config.maxDownloads as never, d),
        }),
    },
    { kind: "spacer" },
    { kind: "heading", label: "Network" },
    {
      kind: "prompt",
      label: "Trackers",
      value:
        config.trackers.length === 0
          ? "none saved"
          : `${config.trackers.length} tracker${config.trackers.length === 1 ? "" : "s"}`,
      open: openTrackersPrompt,
    },
    { kind: "spacer" },
    { kind: "heading", label: "Application" },
    {
      kind: "choice",
      label: "Update check",
      value: config.checkForUpdates ? "on" : "off",
      step: () => setConfig({ ...config, checkForUpdates: !config.checkForUpdates }),
    },
  ];

  const stops = rows.flatMap((r, i) => (selectable(r) ? [i] : []));
  const [stop, setStop] = useState(0);
  const clamped = Math.min(stop, stops.length - 1);
  const cursor = stops[clamped]!;

  // Functional, not from the render closure: two keypresses inside one frame
  // would otherwise both read the same cursor and the second would be lost.
  const move = (delta: number): void =>
    setStop((s) => wrapStep(Math.min(s, stops.length - 1), delta, stops.length));

  useInput(
    (input, key) => {
      if (key.upArrow || input === "k") move(-1);
      else if (key.downArrow || input === "j") move(1);
      else {
        const row = rows[cursor]!;
        if (row.kind === "choice") {
          if (key.rightArrow || input === "l" || key.return) row.step(1);
          else if (key.leftArrow || input === "h") row.step(-1);
        } else if (row.kind === "prompt" && (key.return || key.rightArrow || input === "l")) {
          row.open();
        }
      }
    },
    { isActive: focused },
  );

  const panelH = Math.max(5, listRows - 1);
  const visibleRows = Math.max(1, panelH - 1);
  const start = windowStart(cursor, rows.length, visibleRows);
  const visible = rows.slice(start, start + visibleRows);

  const labelWidth = Math.max(...rows.filter(selectable).map((r) => r.label.length)) + 2;
  // Two columns for the chevron on each side, two for the pointer gutter.
  const valueWidth = Math.max(8, contentWidth - labelWidth - 6);

  return (
    <Panel title="settings" width={contentWidth} focused={focused} height={panelH}>
      {visible.map((row, i) => {
        const index = start + i;

        if (row.kind === "spacer") {
          // A space, not an empty string: Ink gives a Text node with no content
          // no height, and the blank line has to occupy the row the window
          // budgeted for it.
          return (
            <Box key={`s${index}`}>
              <Text> </Text>
            </Box>
          );
        }

        if (row.kind === "heading") {
          return (
            <Box key={`h${index}`}>
              <Text bold dimColor>
                {row.label}
              </Text>
            </Box>
          );
        }

        const here = index === cursor && focused;
        return (
          <Box key={row.label}>
            <Box width={2} flexShrink={0}>
              <Text color={COLOR.accent} bold>
                {here ? ICON.pointer : ""}
              </Text>
            </Box>
            <Box width={labelWidth} flexShrink={0}>
              <Text color={here ? COLOR.accent : undefined} bold={here} dimColor={!here}>
                {row.label}
              </Text>
            </Box>
            <Box flexGrow={1} minWidth={0}>
              {row.kind === "choice" ? (
                // The chevrons only appear on the focused row: they are an
                // affordance for the keys, not decoration on every line. Their
                // two columns are still reserved when absent, so nothing shifts
                // as the cursor moves.
                <Text>
                  <Text dimColor>{here ? "‹ " : "  "}</Text>
                  <Text color={here ? COLOR.text : undefined} dimColor={!here}>
                    {truncate(row.value, valueWidth)}
                  </Text>
                  <Text dimColor>{here ? " ›" : "  "}</Text>
                </Text>
              ) : (
                // Two leading spaces so the value column lines up with the
                // choice rows, which spend them on their chevron.
                <Text>
                  <Text dimColor>{"  "}</Text>
                  <Text color={here ? COLOR.text : undefined} dimColor={!here}>
                    {truncate(row.value, valueWidth)}
                  </Text>
                </Text>
              )}
            </Box>
          </Box>
        );
      })}
    </Panel>
  );
}
