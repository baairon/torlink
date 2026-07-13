import type { ParsedRelease } from "./types";

const VIDEO_EXT = /\.(mkv|mp4|avi|m4v|mov|wmv)$/i;
const STRIP_EXT = /\.(mkv|mp4|avi|m4v|mov|wmv|srt)$/i;

const SOURCES: Record<string, string> = {
  web: "web",
  webdl: "web",
  webrip: "web",
  amzn: "web",
  nf: "web",
  bluray: "bluray",
  bdrip: "bluray",
  brrip: "bluray",
  hdtv: "hdtv",
  dvd: "dvd",
  dvdrip: "dvd",
};

const RESOLUTION = /^(2160|1080|720|480)p$/;
const CODEC = /^[xh]26[45]$/;
const SE = /^s(\d{1,2})e(\d{1,3})$/;
const NXN = /^(\d{1,2})x(\d{2,3})$/;
const YEAR = /^(19|20)\d{2}$/;

// A trailing -TOKEN is only a release group when it isn't an attribute word.
const NOT_GROUP = /^(dl|rip|web|hdtv|dvd|bluray|[xh]26[45]|\d{3,4}p)$/i;

export function isVideoFile(path: string): boolean {
  return VIDEO_EXT.test(path);
}

export function parseRelease(name: string): ParsedRelease {
  let s = name.replace(STRIP_EXT, "");
  s = s.replace(/([xh])\.(26[45])/gi, "$1$2");

  let group: string | undefined;
  const bracket = s.match(/^\[([^\]]+)\]\s*/);
  if (bracket) {
    group = bracket[1]!.toLowerCase();
    s = s.slice(bracket[0].length);
  }
  const tail = s.match(/-([A-Za-z0-9]+)\s*$/);
  if (tail && !NOT_GROUP.test(tail[1]!)) {
    group ??= tail[1]!.toLowerCase();
    s = s.slice(0, tail.index);
  }

  const tokens = s
    .toLowerCase()
    .replace(/[()[\]]/g, " ")
    .split(/[\s._-]+/)
    .filter(Boolean);

  const parsed: ParsedRelease = { title: "" };
  if (group) parsed.group = group;
  let markerIdx = -1;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    let isMarker = true;
    let m: RegExpMatchArray | null;
    if ((m = t.match(SE)) || (m = t.match(NXN))) {
      parsed.season ??= parseInt(m[1]!, 10);
      parsed.episode ??= parseInt(m[2]!, 10);
    } else if (YEAR.test(t)) {
      parsed.year ??= parseInt(t, 10);
    } else if (RESOLUTION.test(t)) {
      parsed.resolution ??= t;
    } else if (SOURCES[t]) {
      parsed.source ??= SOURCES[t];
    } else if (CODEC.test(t)) {
      parsed.codec ??= t;
    } else {
      isMarker = false;
    }
    if (isMarker && markerIdx === -1) markerIdx = i;
  }

  parsed.title = (markerIdx === -1 ? tokens : tokens.slice(0, markerIdx)).join(" ");
  return parsed;
}
