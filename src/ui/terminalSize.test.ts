import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { DEFAULT_COLS, DEFAULT_ROWS, terminalSize } from "./terminalSize";

function ttyLike(rows: unknown, columns: unknown): NodeJS.WritableStream {
  return Object.assign(new PassThrough(), { rows, columns });
}

describe("terminalSize", () => {
  it("reads the live size from a TTY-shaped stream", () => {
    expect(terminalSize(ttyLike(30, 110))).toEqual({ rows: 30, cols: 110 });
  });

  it("follows the stream when it resizes", () => {
    const stream = ttyLike(30, 110);
    Object.assign(stream, { rows: 16, columns: 70 });
    expect(terminalSize(stream)).toEqual({ rows: 16, cols: 70 });
  });

  it("falls back for a plain stream with no TTY properties", () => {
    expect(terminalSize(new PassThrough())).toEqual({ rows: DEFAULT_ROWS, cols: DEFAULT_COLS });
  });

  it("falls back when there is no stream at all", () => {
    expect(terminalSize(undefined)).toEqual({ rows: DEFAULT_ROWS, cols: DEFAULT_COLS });
  });

  it("falls back per dimension when a value is missing or not a number", () => {
    expect(terminalSize(ttyLike(undefined, 100))).toEqual({ rows: DEFAULT_ROWS, cols: 100 });
    expect(terminalSize(ttyLike(40, "wide"))).toEqual({ rows: 40, cols: DEFAULT_COLS });
  });

  it("keeps a reported zero instead of treating it as missing", () => {
    expect(terminalSize(ttyLike(0, 0))).toEqual({ rows: 0, cols: 0 });
  });
});
