import { HELP_GROUPS } from "./keymap";

export const KEY_GAP = 2;
export const COL_GAP = 2;
export const FRAME = 4; // border 2 + paddingX 2

export const KEY_W = HELP_GROUPS.map(
  (g) => Math.max(...g.hints.map((h) => h.keys.length)) + KEY_GAP,
);
const COL_W = HELP_GROUPS.map(
  (g, i) => KEY_W[i]! + Math.max(...g.hints.map((h) => h.label.length)),
);
const ROWS_PER_GROUP = HELP_GROUPS.map((g) => g.hints.length + 1); // title + hints

// Group-index packings, widest first (which is also shortest first, so the
// width rule below doubles as a height minimizer).
const LAYOUTS: number[][][] = [
  [[0], [1], [2], [3]], // 4-col
  [[0], [1, 3], [2]], // 3-col, Seeding under Search
  [[0, 1], [2, 3]], // 2-col: browse column | transfers column
  [[0, 1, 2, 3]], // 1-col
];

export const MEASURED = LAYOUTS.map((layout) => {
  const colWidths = layout.map((col) => Math.max(...col.map((gi) => COL_W[gi]!)));
  const width =
    colWidths.reduce((a, b) => a + b, 0) + (layout.length - 1) * COL_GAP + FRAME;
  const gridH = Math.max(
    ...layout.map(
      (col) => col.reduce((a, gi) => a + ROWS_PER_GROUP[gi]!, 0) + (col.length - 1),
    ),
  );
  return { layout, colWidths, width, gridH };
});

export function pickLayout(cols: number) {
  return MEASURED.find((m) => m.width <= cols - 2) ?? MEASURED.at(-1)!;
}
