import { describe, it, expect } from "vitest";
import { parseCliArgs } from "./args";

describe("parseCliArgs", () => {
  it("defaults to run with no args", () => {
    expect(parseCliArgs([])).toEqual({ kind: "run" });
  });
  it("parses version and help flags", () => {
    expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseCliArgs(["-v"])).toEqual({ kind: "version" });
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
  });
  it("launches a magnet", () => {
    expect(parseCliArgs(["magnet:?xt=urn:btih:abc"])).toEqual({
      kind: "run",
      initialMagnet: "magnet:?xt=urn:btih:abc",
    });
  });
  it("launches a .torrent file", () => {
    expect(parseCliArgs(["./Foo.torrent"])).toEqual({
      kind: "run",
      initialTorrent: "./Foo.torrent",
    });
  });
  it("launches a bare infohash as a magnet (DHT)", () => {
    const hash = "abcdef0123456789abcdef0123456789abcdef01";
    expect(parseCliArgs([hash])).toEqual({ kind: "run", initialMagnet: hash });
  });
  it("rejects unknown arguments", () => {
    expect(parseCliArgs(["--nope"])).toEqual({ kind: "invalid", arg: "--nope" });
  });
  it("rejects a non-hash bareword", () => {
    expect(parseCliArgs(["hello"])).toEqual({ kind: "invalid", arg: "hello" });
  });
  it("parses serve with defaults", () => {
    expect(parseCliArgs(["serve"])).toEqual({
      kind: "serve",
      port: undefined,
      host: undefined,
      token: undefined,
      downloadDir: undefined,
    });
  });
  it("parses serve flags", () => {
    expect(
      parseCliArgs(["serve", "--port", "9999", "--host", "0.0.0.0", "--token", "s3cret", "--to", "/mnt/media"]),
    ).toEqual({
      kind: "serve",
      port: 9999,
      host: "0.0.0.0",
      token: "s3cret",
      downloadDir: "/mnt/media",
    });
  });
  it("ignores a bad --port", () => {
    expect(parseCliArgs(["serve", "--port", "abc"]).kind).toBe("serve");
    expect((parseCliArgs(["serve", "--port", "abc"]) as { port?: number }).port).toBeUndefined();
  });
});
