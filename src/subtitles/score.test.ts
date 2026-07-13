import { describe, it, expect } from "vitest";
import { pickBest } from "./score";
import { parseRelease } from "./parse";
import type { SubtitleCandidate } from "./types";

function cand(releaseName: string, lang = "en"): SubtitleCandidate {
  return { releaseName, lang, downloadUrl: `http://x/${releaseName}` };
}

const tv = parseRelease("Severance.S02E01.1080p.WEB.H264-NTb.mkv");
const movie = parseRelease("Inception.2010.1080p.BluRay.x264-YIFY");

describe("pickBest gates", () => {
  it("excludes wrong lang", () => {
    expect(pickBest(tv, [cand("Severance.S02E01.1080p.WEB.H264-NTb", "fr")], "en")).toBeNull();
  });

  it("matches lang case-insensitively", () => {
    const c = cand("Severance.S02E01.1080p.WEB.H264-NTb", "EN");
    expect(pickBest(tv, [c], "en")).toBe(c);
  });

  it("excludes title mismatch", () => {
    expect(pickBest(tv, [cand("Shrinking.S02E01.1080p.WEB.H264-NTb")], "en")).toBeNull();
  });

  it("excludes wrong episode", () => {
    expect(pickBest(tv, [cand("Severance.S02E02.1080p.WEB.H264-NTb")], "en")).toBeNull();
  });

  it("excludes wrong year for movies", () => {
    expect(pickBest(movie, [cand("Inception.2011.1080p.BluRay.x264-YIFY")], "en")).toBeNull();
  });

  it("candidate without a year passes the year gate", () => {
    const c = cand("Inception.1080p.BluRay.x264-YIFY");
    expect(pickBest(movie, [c], "en")).toBe(c);
  });
});

describe("pickBest scoring", () => {
  it("group match (8) outranks source+resolution+codec (7)", () => {
    const groupOnly = cand("Inception.2010.480p.HDTV.x265-YIFY");
    const rest = cand("Inception.2010.1080p.BluRay.x264-OTHER");
    expect(pickBest(movie, [rest, groupOnly], "en")).toBe(groupOnly);
  });

  it("source (4) outranks resolution+codec (3)", () => {
    const sourceOnly = cand("Inception.2010.480p.BluRay.x265-A");
    const resCodec = cand("Inception.2010.1080p.HDTV.x264-B");
    expect(pickBest(movie, [resCodec, sourceOnly], "en")).toBe(sourceOnly);
  });

  it("resolution (2) outranks codec (1)", () => {
    const resOnly = cand("Inception.2010.1080p.HDTV.x265-A");
    const codecOnly = cand("Inception.2010.480p.HDTV.x264-B");
    expect(pickBest(movie, [codecOnly, resOnly], "en")).toBe(resOnly);
  });

  it("treats x264 and h264 as equivalent codecs", () => {
    const h264 = cand("Inception.2010.1080p.HDTV.h264-A");
    const x265 = cand("Inception.2010.1080p.HDTV.x265-B");
    expect(pickBest(movie, [x265, h264], "en")).toBe(h264);
  });

  it("accepts a sole TV survivor at score 0", () => {
    const c = cand("Severance S02E01");
    expect(pickBest(tv, [c], "en")).toBe(c);
  });

  it("rejects a movie at score below 2", () => {
    expect(pickBest(movie, [cand("Inception.2010")], "en")).toBeNull();
    expect(pickBest(movie, [cand("Inception.2010.x264")], "en")).toBeNull();
  });

  it("accepts a movie at score >= 2", () => {
    const c = cand("Inception.2010.1080p");
    expect(pickBest(movie, [c], "en")).toBe(c);
  });

  it("breaks ties by input order", () => {
    const a = cand("Inception.2010.1080p.A");
    const b = cand("Inception.2010.1080p.B");
    expect(pickBest(movie, [a, b], "en")).toBe(a);
  });

  it("returns null for empty candidates", () => {
    expect(pickBest(movie, [], "en")).toBeNull();
  });
});
