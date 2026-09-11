import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { airplayPlan, buildVarStreamMap, findHelperScript } from "./players.js";

describe("airplayPlan", () => {
  it("direct for tvOS-native containers regardless of codec", () => {
    expect(airplayPlan("http://x/video.mp4", "mpeg2video")).toEqual({ mode: "direct" });
    expect(airplayPlan("/tmp/movie.M4V", null)).toEqual({ mode: "direct" });
  });

  it("remux (copy) when video codec is already tvOS-compatible", () => {
    expect(airplayPlan("http://x/movie.mkv", "h264")).toEqual({ mode: "transcode", video: "copy" });
  });

  it("re-encodes hevc: mpegts HLS cannot carry it and this ATV rejects fmp4", () => {
    expect(airplayPlan("http://x/movie.mkv", "hevc")).toEqual({ mode: "transcode", video: "encode" });
  });

  it("re-encode for incompatible video codecs", () => {
    expect(airplayPlan("http://x/movie.mkv", "vp9")).toEqual({ mode: "transcode", video: "encode" });
    expect(airplayPlan("http://x/movie.avi", "mpeg2video")).toEqual({ mode: "transcode", video: "encode" });
  });

  it("direct when probe fails (best effort)", () => {
    expect(airplayPlan("http://x/movie.mkv", null)).toEqual({ mode: "direct" });
  });

  it("locates the airplay helper script from the module location", () => {
    expect(existsSync(findHelperScript())).toBe(true);
  });
});

describe("buildVarStreamMap", () => {
  it("defaults to the first track, passing language tags through", () => {
    const { map, defaultIdx } = buildVarStreamMap(["fre", "eng"]);
    expect(defaultIdx).toBe(0);
    expect(map).toContain("a:0,agroup:aud,language:FRE,default:YES");
    expect(map).toContain("a:1,agroup:aud,language:ENG,default:NO");
    expect(map).toContain("v:0,agroup:aud");
  });

  it("defaults to track 0 when no language tags exist", () => {
    const { map, defaultIdx } = buildVarStreamMap(["", ""]);
    expect(defaultIdx).toBe(0);
    expect(map).toContain("a:0,agroup:aud,default:YES");
    expect(map).not.toContain("language:");
  });

  it("handles a single audio track", () => {
    const { map, defaultIdx } = buildVarStreamMap(["jpn"]);
    expect(defaultIdx).toBe(0);
    expect(map).toBe("a:0,agroup:aud,language:JPN,default:YES v:0,agroup:aud");
  });
});
