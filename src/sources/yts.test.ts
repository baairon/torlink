import { describe, expect, it } from "vitest";
import { toResult } from "./yts";

// Field names and value shapes are verbatim from a YTS list_movies.json response.
const MOVIE = {
  title_long: "The Matrix (1999)",
  title: "The Matrix",
  imdb_code: "tt0133093",
  date_uploaded_unix: 1600000000,
} as const;

const TORRENT = {
  hash: "8C4ADBF9EBDC4C6D1D0F1B0F0E0D0C0B0A090807",
  quality: "1080p",
  type: "bluray",
  size_bytes: 2147483648,
  seeds: 412,
  peers: 17,
} as const;

describe("toResult", () => {
  it("carries the IMDb id YTS supplies", () => {
    expect(toResult({ ...MOVIE }, { ...TORRENT })).toMatchObject({
      infoHash: "8c4adbf9ebdc4c6d1d0f1b0f0e0d0c0b0a090807",
      source: "yts",
      imdbId: "tt0133093",
    });
  });

  it("leaves the id absent when YTS's value doesn't look like an IMDb id", () => {
    expect(toResult({ ...MOVIE, imdb_code: "133093" }, { ...TORRENT })?.imdbId).toBeUndefined();
    expect(toResult({ ...MOVIE, imdb_code: "" }, { ...TORRENT })?.imdbId).toBeUndefined();
  });

  it("leaves the id absent when YTS omits the field entirely", () => {
    const { imdb_code: _imdbCode, ...withoutImdb } = MOVIE;
    expect(toResult(withoutImdb, { ...TORRENT })?.imdbId).toBeUndefined();
  });

  it("still drops rows with no usable hash", () => {
    expect(toResult({ ...MOVIE }, { ...TORRENT, hash: undefined })).toBeNull();
  });
});
