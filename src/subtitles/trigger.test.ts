import { describe, it, expect } from "vitest";
import { classifyForSubtitles } from "./trigger";

describe("classifyForSubtitles", () => {
  it("movie source with a year", () => {
    expect(classifyForSubtitles("yts", "Inception.2010.1080p.BluRay.x264-REFiNED")).toBe("movie");
  });

  it("movie source without a year still classifies as movie (title-only search)", () => {
    expect(classifyForSubtitles("yts", "Inception.1080p.BluRay.x264")).toBe("movie");
  });

  it("tv source with SxxEyy", () => {
    expect(classifyForSubtitles("eztv", "Severance.S02E03.1080p.WEB.h264")).toBe("tv");
  });

  it("tv source without an episode marker", () => {
    expect(classifyForSubtitles("eztv", "Severance.1080p.WEB.h264")).toBe(null);
  });

  it("games source is never classified, even with a year", () => {
    expect(classifyForSubtitles("fitgirl", "Elden.Ring.2022.Repack")).toBe(null);
  });

  it("anime sources are never classified", () => {
    expect(classifyForSubtitles("nyaa", "[SubsPlease] Frieren - S01E05 (1080p)")).toBe(null);
    expect(classifyForSubtitles("subsplease", "[SubsPlease] Frieren S01E05 (1080p)")).toBe(null);
  });

  it("undefined source with SxxEyy", () => {
    expect(classifyForSubtitles(undefined, "Severance.S01E02.720p.HDTV.x264")).toBe("tv");
  });

  it("undefined source with a year", () => {
    expect(classifyForSubtitles(undefined, "Oldboy.2003.1080p.BluRay")).toBe("movie");
  });

  it("undefined source with neither episode nor year", () => {
    expect(classifyForSubtitles(undefined, "Some Random Bundle")).toBe(null);
  });
});

// A season pack from a TV source (or pasted) has no SxxEyy in the torrent
// name; season alone must classify tv so per-episode fetching can run.
describe("classifyForSubtitles season packs", () => {
  it("eztv season-only pack is tv", () => {
    expect(classifyForSubtitles("eztv", "Severance.S01.1080p.WEB.h264")).toBe("tv");
  });
  it("pasted Season-word pack is tv", () => {
    expect(classifyForSubtitles(undefined, "The.Bear.Season.2.Complete.720p.WEB")).toBe("tv");
  });
});
