import { eztv } from "./eztv";
import { fitgirl } from "./fitgirl";
import { nyaa } from "./nyaa";
import { subsplease } from "./subsplease";
import { tpbMovies, tpbTv } from "./piratebay";
import { x1337Movies, x1337Tv } from "./x1337";
import { yts } from "./yts";
import type { Source, SourceGroup, SourceId } from "./types";

export const SOURCES: readonly Source[] = [
  fitgirl,
  yts,
  tpbMovies,
  x1337Movies,
  eztv,
  tpbTv,
  x1337Tv,
  nyaa,
  subsplease,
];

export const DEFAULT_SOURCE: Source = SOURCES[0]!;

export function getSource(id: SourceId): Source {
  return SOURCES.find((s) => s.id === id) ?? DEFAULT_SOURCE;
}

const GROUP_ORDER: readonly SourceGroup[] = ["Games", "Movies", "TV", "Anime"];

export function sourcesByGroup(): { group: SourceGroup; sources: Source[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    sources: SOURCES.filter((s) => s.group === group),
  })).filter((g) => g.sources.length > 0);
}
