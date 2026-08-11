import { describe, it, expect } from "vitest";
import { resolveTorrentPath, unquote, fromFileUrl } from "./torrentPath";

// Both platforms are exercised from either host: the point of the module is
// that a path escaped by one OS's terminal is understood, and CI shouldn't
// only check the half that matches the runner.
const WIN = { windows: true, home: "C:\\Users\\u" };
const NIX = { windows: false, home: "/home/u" };

describe("unquote", () => {
  it("strips a matching pair of double quotes and the trailing space a drop leaves", () => {
    expect(unquote('"C:\\Users\\u\\a.torrent" ')).toBe("C:\\Users\\u\\a.torrent");
  });
  it("strips single quotes too", () => {
    expect(unquote("'/home/u/a.torrent'")).toBe("/home/u/a.torrent");
  });
  it("leaves an unmatched or interior quote alone", () => {
    expect(unquote('"/home/u/a.torrent')).toBe('"/home/u/a.torrent');
    expect(unquote("/home/u/it's.torrent")).toBe("/home/u/it's.torrent");
  });
});

describe("fromFileUrl", () => {
  it("decodes a POSIX file URI", () => {
    expect(fromFileUrl("file:///home/u/My%20Show.torrent", false)).toBe("/home/u/My Show.torrent");
  });
  it("drops the slash before a Windows drive letter", () => {
    expect(fromFileUrl("file:///C:/Users/u/a.torrent", true)).toBe("C:/Users/u/a.torrent");
  });
  it("accepts the file://localhost/ form", () => {
    expect(fromFileUrl("file://localhost/home/u/a.torrent", false)).toBe("/home/u/a.torrent");
  });
  it("returns null for a non-URI and for a broken escape", () => {
    expect(fromFileUrl("/home/u/a.torrent", false)).toBe(null);
    expect(fromFileUrl("file:///home/u/100%.torrent", false)).toBe(null);
  });
});

describe("resolveTorrentPath", () => {
  it("takes the quoted path with a trailing space that Windows Terminal drops", () => {
    expect(resolveTorrentPath('"C:\\Users\\u\\Downloads\\My Show.torrent" ', WIN)).toBe(
      "C:\\Users\\u\\Downloads\\My Show.torrent",
    );
  });
  it("keeps Windows backslashes rather than reading them as escapes", () => {
    expect(resolveTorrentPath("C:\\Users\\u\\a.torrent", WIN)).toBe("C:\\Users\\u\\a.torrent");
  });
  it("unescapes the backslashes macOS and Linux terminals add for spaces", () => {
    expect(resolveTorrentPath("/home/u/My\\ Show\\ \\(2024\\).torrent", NIX)).toBe(
      "/home/u/My Show (2024).torrent",
    );
  });
  it("resolves the file:// URI GNOME Terminal pastes", () => {
    expect(resolveTorrentPath("file:///home/u/My%20Show.torrent", NIX)).toBe(
      "/home/u/My Show.torrent",
    );
  });
  it("expands a typed ~ path", () => {
    expect(resolveTorrentPath("~/Downloads/a.torrent", NIX)).toBe("/home/u/Downloads/a.torrent");
  });
  it("accepts an uppercase extension", () => {
    expect(resolveTorrentPath("/home/u/A.TORRENT", NIX)).toBe("/home/u/A.TORRENT");
  });
  it("returns null for a search query, a magnet, and empty input", () => {
    expect(resolveTorrentPath("the matrix 1999", NIX)).toBe(null);
    expect(resolveTorrentPath("magnet:?xt=urn:btih:" + "a".repeat(40), NIX)).toBe(null);
    expect(resolveTorrentPath("   ", NIX)).toBe(null);
  });
  it("returns null for a file that isn't a .torrent", () => {
    expect(resolveTorrentPath('"C:\\Users\\u\\holiday.mp4"', WIN)).toBe(null);
  });
});
