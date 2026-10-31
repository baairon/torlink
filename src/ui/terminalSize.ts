// Ink types useStdout().stdout as a generic stream, and rows/columns only exist
// on a real TTY. Piped output, a test stream, or a terminal that hasn't reported
// a size all land on the classic 80x24 instead of an undefined layout.
export const DEFAULT_ROWS = 24;
export const DEFAULT_COLS = 80;

export interface TerminalSize {
  rows: number;
  cols: number;
}

export function terminalSize(stream: NodeJS.WritableStream | undefined): TerminalSize {
  return {
    rows: stream && "rows" in stream && typeof stream.rows === "number" ? stream.rows : DEFAULT_ROWS,
    cols:
      stream && "columns" in stream && typeof stream.columns === "number"
        ? stream.columns
        : DEFAULT_COLS,
  };
}
