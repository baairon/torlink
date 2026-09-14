import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPlaylists, writePlaylists } from "./playlist";
import { logCrash } from "../util/crashlog";

vi.mock("../util/crashlog", () => ({ logCrash: vi.fn() }));

describe("buildPlaylists", () => {
  it("collects descendants at every ancestor and naturally orders modules and lessons", () => {
    const playlists = buildPlaylists([
      "Course/Module 10/1.mp4",
      "Course/Module 2/10.mp4",
      "Course/Module 2/2.mp4",
      "Course/Module 2/1.MP4",
      "Course/Module 1/1.mp4",
      "Course/Module 2/notes.pdf",
      "Course/Module 2/captions.srt",
      "Course/Module 2/cover.jpg",
      "Course/Module 2/example.ts",
    ]);
    expect([...playlists.keys()].sort()).toEqual(["Course/Module 2/playlist.m3u", "Course/playlist.m3u"]);
    expect(playlists.get("Course/playlist.m3u")).toBe(
      "#EXTM3U\n./Module%201/1.mp4\n./Module%202/1.MP4\n./Module%202/2.mp4\n./Module%202/10.mp4\n./Module%2010/1.mp4\n",
    );
    expect(playlists.get("Course/Module 2/playlist.m3u")).toBe("#EXTM3U\n./1.MP4\n./2.mp4\n./10.mp4\n");
  });

  it("includes audio and deeply nested single lessons in their common ancestors", () => {
    const playlists = buildPlaylists([
      "Course/Lessons/1/intro.MP3",
      "Course/Lessons/2/lesson.flac",
      "Course/notes.txt",
    ]);
    expect([...playlists.keys()]).toEqual(["Course/playlist.m3u", "Course/Lessons/playlist.m3u"]);
  });

  it.each([
    [],
    ["movie.mp4"],
    ["Course/Module 1/lesson.mp4", "Course/readme.txt", "Course/cover.png"],
    ["One/one.mp4", "Two/two.mp4"],
    ["Course/one.mp4", "Course/one.mp4"],
    ["Course/readme.txt", "Course/notes.pdf"],
  ])("skips single-media and non-media folders: %j", (...files) => {
    expect(buildPlaylists(files as string[]).size).toBe(0);
  });

  it("uses native torrent paths and portable relative URI entries", () => {
    const names = ["1 #intro 100%.mp4", "2 café & résumé?.mp3", "3: recap.mp4"];
    const playlists = buildPlaylists(names.map((name) => path.join("Course", name)));
    const entries = playlists.get("Course/playlist.m3u")!.trim().split("\n").slice(1);
    expect(entries).toHaveLength(names.length);
    const local = pathToFileURL(path.resolve("Course/playlist.m3u"));
    entries.forEach((entry, i) => {
      expect(fileURLToPath(new URL(entry, local))).toBe(path.resolve("Course", names[i]!));
      const remote = new URL(entry, "https://example.test/Course/playlist.m3u");
      expect(decodeURIComponent(remote.pathname)).toBe(`/Course/${names[i]}`);
      expect(remote.hash).toBe("");
      expect(remote.search).toBe("");
    });
  });

  it("reserves playlists supplied by the torrent, including differently cased names", () => {
    expect(buildPlaylists(["Course/1.mp4", "Course/2.mp4", "Course/Playlist.M3U"]).size).toBe(0);
  });

  it("ignores traversal, absolute paths, and playlist injection", () => {
    const bad = ["../escape", "/absolute", "C:/drive", "\\\\server\\share", "Course/../escape", "Course\n#EXTINF:0,bad"];
    const files = bad.flatMap((dir) => [`${dir}/1.mp4`, `${dir}/2.mp4`]);
    expect(buildPlaylists(files).size).toBe(0);
  });
});

describe("writePlaylists", () => {
  let dir: string;
  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-playlists-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes only inside the torrent's existing folders and preserves existing playlists", async () => {
    const module = path.join(dir, "Course", "Module");
    await fs.mkdir(module, { recursive: true });
    const existing = path.join(module, "playlist.m3u");
    await fs.writeFile(existing, "my custom playlist\n");
    const files = ["Course/Module/1.mp4", "Course/Module/2.mp4"];
    await writePlaylists(dir, files);
    expect(await fs.readFile(path.join(dir, "Course", "playlist.m3u"), "utf8"))
      .toBe("#EXTM3U\n./Module/1.mp4\n./Module/2.mp4\n");
    expect(await fs.readFile(existing, "utf8")).toBe("my custom playlist\n");
    expect(await fs.readdir(dir)).toEqual(["Course"]);
    await writePlaylists(dir, files);
    expect(logCrash).not.toHaveBeenCalled();
  });

  it("does not recreate deleted folders and still writes other eligible playlists", async () => {
    await fs.mkdir(path.join(dir, "Course", "Kept"), { recursive: true });
    await expect(writePlaylists(dir, [
      "Course/Deleted/1.mp4", "Course/Deleted/2.mp4",
      "Course/Kept/1.mp4", "Course/Kept/2.mp4",
    ])).resolves.toBeUndefined();
    expect(await fs.readdir(path.join(dir, "Course"))).toEqual(["Kept", "playlist.m3u"]);
    expect(await fs.readFile(path.join(dir, "Course", "Kept", "playlist.m3u"), "utf8"))
      .toBe("#EXTM3U\n./1.mp4\n./2.mp4\n");
    expect(logCrash).toHaveBeenCalledWith("playlist", expect.any(Error));
  });

  it("refuses to write through a directory symlink outside the downloads root", async () => {
    const downloads = path.join(dir, "downloads");
    const outside = path.join(dir, "outside");
    await fs.mkdir(downloads);
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(downloads, "Course"), "junction");
    await writePlaylists(downloads, ["Course/1.mp4", "Course/2.mp4"]);
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it("leaves an existing playlist symlink alone", async () => {
    const course = path.join(dir, "Course");
    const outside = path.join(dir, "outside");
    await fs.mkdir(course);
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(course, "playlist.m3u"), "junction");
    await writePlaylists(dir, ["Course/1.mp4", "Course/2.mp4"]);
    expect((await fs.lstat(path.join(course, "playlist.m3u"))).isSymbolicLink()).toBe(true);
    expect(await fs.readdir(outside)).toEqual([]);
  });
});
