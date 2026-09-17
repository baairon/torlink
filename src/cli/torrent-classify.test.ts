import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classificationSummary, classifyTorrent, classifyTorrentFile, watchDirForClassification } from "./torrent-classify";

const file = (name: string, length: number) => ({ name, length });
const bstr = (value: string) => `${Buffer.byteLength(value)}:${value}`;

function torrentFile(files: Array<{ name: string; length: number }>): Buffer {
  const single = files[0]!;
  const entries = files.length === 1
    ? `6:lengthi${single.length}e4:name${bstr(single.name)}`
    : `5:filesl${files.map((f) => `d6:lengthi${f.length}e4:pathl${bstr(f.name)}ee`).join("")}e`;
  const rootName = files.length === 1 ? "" : `4:name${bstr("fixture")}`;
  return Buffer.from(`d4:infod${entries}${rootName}12:piece lengthi16384e6:pieces20:xxxxxxxxxxxxxxxxxxxxee`);
}

describe("classifyTorrent", () => {
  it("classifies a single movie file", () => {
    expect(classifyTorrent({ files: [file("Movie.mkv", 8_000)] }).type).toBe("video");
  });

  it("ignores movie subtitles and artwork", () => {
    expect(classifyTorrent({ files: [file("Movie.mp4", 8_000), file("cover.jpg", 20), file("sub.srt", 10)] })).toMatchObject({ type: "video", videoBytes: 8_000, totalBytes: 8_030 });
  });

  it("classifies a multi-file FLAC album", () => {
    expect(classifyTorrent({ files: [file("01.flac", 2_000), file("02.flac", 2_100)] }).type).toBe("audio");
  });

  it("classifies a multi-file MP3 album", () => {
    expect(classifyTorrent({ files: [file("01.mp3", 200), file("02.mp3", 210)] }).type).toBe("audio");
  });

  it("ignores album cover art and cue sheets", () => {
    const result = classifyTorrent({ files: [file("01.flac", 2_000), file("cover.jpg", 20), file("album.cue", 3)] });
    expect(result).toMatchObject({ type: "audio", audioBytes: 2_000, totalBytes: 2_023 });
  });

  it("uses byte totals for mixed content and makes ties unknown", () => {
    expect(classifyTorrent({ files: [file("clip.mp4", 900), file("song.flac", 1_000)] }).type).toBe("audio");
    expect(classifyTorrent({ files: [file("clip.mp4", 1_000), file("song.flac", 1_000)] }).type).toBe("unknown");
  });

  it("returns unknown for unavailable or malformed metadata", () => {
    expect(classifyTorrent({}).type).toBe("unknown");
    expect(classifyTorrent({ files: [file("broken.mp3", -1)] }).type).toBe("unknown");
  });

  it("parses actual single-file and multi-file torrent metainfo", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "torlink-classify-"));
    try {
      const movie = path.join(dir, "movie.torrent");
      const album = path.join(dir, "album.torrent");
      await writeFile(movie, torrentFile([file("Movie.mkv", 8_000)]));
      await writeFile(album, torrentFile([file("01.flac", 2_000), file("02.flac", 2_100)]));
      await expect(classifyTorrentFile(movie)).resolves.toMatchObject({ type: "video", videoBytes: 8_000 });
      await expect(classifyTorrentFile(album)).resolves.toMatchObject({ type: "audio", audioBytes: 4_100 });
      await writeFile(movie, "not torrent metadata");
      await expect(classifyTorrentFile(movie)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the default watch folder when music watch is absent", () => {
    const audio = classifyTorrent({ files: [file("track.opus", 1)] });
    expect(watchDirForClassification(audio, "C:/movies", "")).toBe("C:/movies");
    expect(watchDirForClassification(audio, "C:/movies", "C:/music")).toBe("C:/music");
  });

  it("formats a concise routing log message", () => {
    expect(classificationSummary(classifyTorrent({ files: [file("track.mp3", 978), file("cover.jpg", 22)] }))).toBe("Torrent classified AUDIO (97.8% audio)");
  });
});
