import { describe, it, expect } from "vitest";
import {
  unquote,
  fromFileUrl,
  resolveTorrentPath,
  type TorrentPathOptions,
} from "./torrentPath";

const WIN: TorrentPathOptions = { windows: true, home: "C:\\Users\\u" };
const NIX: TorrentPathOptions = { windows: false, home: "/home/u" };

describe("unquote", () => {
  it("strips matched double and single quotes", () => {
    expect(unquote('"a"')).toBe("a");
    expect(unquote("'a'")).toBe("a");
  });
  it("strips trailing space dropped paths arrive with", () => {
    expect(unquote('"C:\\a.torrent" ')).toBe("C:\\a.torrent");
    expect(unquote("  /a.torrent   ")).toBe("/a.torrent");
  });
  it("leaves unmatched quotes alone", () => {
    expect(unquote('"a')).toBe('"a');
    expect(unquote("a'")).toBe("a'");
  });
  it("handles empty and single-char input", () => {
    expect(unquote("")).toBe("");
    expect(unquote('"')).toBe('"');
  });
});

describe("fromFileUrl", () => {
  it("converts a POSIX file URI", () => {
    expect(fromFileUrl("file:///home/u/a.torrent", false)).toBe("/home/u/a.torrent");
    expect(fromFileUrl("file://localhost/home/u/a.torrent", false)).toBe("/home/u/a.torrent");
  });
  it("converts a Windows file URI and strips the slash before the drive", () => {
    expect(fromFileUrl("file:///C:/Users/u/a.torrent", true)).toBe("C:/Users/u/a.torrent");
  });
  it("decodes percent-encoded spaces and UTF-8", () => {
    expect(fromFileUrl("file:///home/u/My%20Show.torrent", false)).toBe(
      "/home/u/My Show.torrent",
    );
  });
  it("returns null for non-file URIs and bad escapes", () => {
    expect(fromFileUrl("https://example.com/a.torrent", false)).toBe(null);
    expect(fromFileUrl("file:///bad%xx.torrent", false)).toBe(null);
    expect(fromFileUrl("/not/a/url", false)).toBe(null);
  });
});

describe("resolveTorrentPath", () => {
  it("strips the double quotes Windows Terminal wraps dropped paths in", () => {
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
