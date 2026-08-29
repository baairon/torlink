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
  it("parses attach", () => {
    expect(parseCliArgs(["attach"])).toEqual({ kind: "attach" });
  });
  it("parses update, with and without --force", () => {
    expect(parseCliArgs(["update"])).toEqual({ kind: "update", force: false });
    expect(parseCliArgs(["update", "--force"])).toEqual({ kind: "update", force: true });
  });
  it("parses headless searches", () => {
    expect(parseCliArgs(["search", "ubuntu"])).toEqual({ kind: "search", query: "ubuntu" });
    expect(parseCliArgs(["search", "example", "movie", "--category", "movies"])).toEqual({
      kind: "search",
      query: "example movie",
      category: "movies",
    });
    expect(parseCliArgs(["search", "--category", "games", "ubuntu"])).toEqual({
      kind: "search",
      query: "ubuntu",
      category: "games",
    });
  });
  it("rejects invalid headless searches", () => {
    expect(parseCliArgs(["search"])).toEqual({ kind: "invalid", arg: "search (missing query)" });
    expect(parseCliArgs(["search", "ubuntu", "--category", "books"])).toEqual({
      kind: "invalid",
      arg: "search (invalid category 'books')",
    });
    expect(parseCliArgs(["search", "ubuntu", "--limit", "10"])).toEqual({
      kind: "invalid",
      arg: "search (unknown --limit)",
    });
    expect(parseCliArgs(["search", "ubuntu", "--category"])).toEqual({
      kind: "invalid",
      arg: "search (invalid --category)",
    });
  });
  it("parses watch with a directory", () => {
    expect(parseCliArgs(["watch", "/srv/blackhole"])).toEqual({
      kind: "watch",
      dir: "/srv/blackhole",
      downloadDir: undefined,
      seedTimeMs: undefined,
      deleteFiles: false,
      daemon: false,
    });
  });
  it("parses watch with a --to download dir", () => {
    expect(parseCliArgs(["watch", "/srv/blackhole", "--to", "/mnt/media"])).toEqual({
      kind: "watch",
      dir: "/srv/blackhole",
      downloadDir: "/mnt/media",
      seedTimeMs: undefined,
      deleteFiles: false,
      daemon: false,
    });
    expect(parseCliArgs(["watch", "--dir", "/mnt/media", "/srv/blackhole"])).toEqual({
      kind: "watch",
      dir: "/srv/blackhole",
      downloadDir: "/mnt/media",
      seedTimeMs: undefined,
      deleteFiles: false,
      daemon: false,
    });
  });
  it("parses watch --seed-time, --delete-files, and --daemon", () => {
    expect(
      parseCliArgs(["watch", "/srv/bh", "--seed-time", "1h", "--delete-files", "--daemon"]),
    ).toEqual({
      kind: "watch",
      dir: "/srv/bh",
      downloadDir: undefined,
      seedTimeMs: 3_600_000,
      deleteFiles: true,
      daemon: true,
    });
  });
  it("ignores an unparseable --seed-time", () => {
    expect(parseCliArgs(["watch", "/srv/bh", "--seed-time", "soon"])).toEqual({
      kind: "watch",
      dir: "/srv/bh",
      downloadDir: undefined,
      seedTimeMs: undefined,
      deleteFiles: false,
      daemon: false,
    });
  });
  it("rejects watch with no directory", () => {
    expect(parseCliArgs(["watch"])).toEqual({
      kind: "invalid",
      arg: "watch (missing directory)",
    });
  });
  it("parses serve with defaults", () => {
    expect(parseCliArgs(["serve"])).toEqual({
      kind: "serve",
      port: undefined,
      host: undefined,
      token: undefined,
      downloadDir: undefined,
      seedTimeMs: undefined,
      deleteFiles: false,
      daemon: false,
    });
  });
  it("parses serve flags", () => {
    expect(
      parseCliArgs([
        "serve",
        "--port",
        "9999",
        "--host",
        "0.0.0.0",
        "--token",
        "s3cret",
        "--to",
        "/mnt/media",
        "--seed-time",
        "30m",
      ]),
    ).toEqual({
      kind: "serve",
      port: 9999,
      host: "0.0.0.0",
      token: "s3cret",
      downloadDir: "/mnt/media",
      seedTimeMs: 1_800_000,
      deleteFiles: false,
      daemon: false,
    });
  });
  it("ignores a bad --port", () => {
    expect(parseCliArgs(["serve", "--port", "abc"]).kind).toBe("serve");
    expect((parseCliArgs(["serve", "--port", "abc"]) as { port?: number }).port).toBeUndefined();
  });
  it("parses files with defaults", () => {
    expect(parseCliArgs(["files"])).toEqual({
      kind: "files",
      port: undefined,
      host: undefined,
      token: undefined,
      dir: undefined,
      daemon: false,
    });
  });
  it("parses files flags", () => {
    expect(
      parseCliArgs([
        "files",
        "--port",
        "9160",
        "--host",
        "0.0.0.0",
        "--token",
        "s3cret",
        "--dir",
        "/mnt/media",
        "--daemon",
      ]),
    ).toEqual({
      kind: "files",
      port: 9160,
      host: "0.0.0.0",
      token: "s3cret",
      dir: "/mnt/media",
      daemon: true,
    });
  });
});

describe("seed", () => {
  it("takes the path, and the flags the other headless modes take", () => {
    expect(parseCliArgs(["seed", "./album"])).toEqual({
      kind: "seed",
      path: "./album",
      seedTimeMs: undefined,
      deleteFiles: false,
      daemon: false,
    });
    expect(parseCliArgs(["seed", "--seed-time", "2h", "--daemon", "./album"])).toEqual({
      kind: "seed",
      path: "./album",
      seedTimeMs: 2 * 60 * 60 * 1000,
      deleteFiles: false,
      daemon: true,
    });
  });

  // Without a path there is nothing to hash, and defaulting to the cwd would
  // make a bare `torlnk seed` start hashing a home directory.
  it("is invalid with no path", () => {
    expect(parseCliArgs(["seed"])).toEqual({ kind: "invalid", arg: "seed (missing path)" });
  });
});
