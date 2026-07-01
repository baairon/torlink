import { eztv } from "./eztv.js";
import { yts } from "./yts.js";
import { nyaa } from "./nyaa.js";
import { subsplease } from "./subsplease.js";
import { solid } from "./solid.js";
import { fitgirl } from "./fitgirl.js";
import { tpbMovies, tpbTv } from "./piratebay.js";

export const SOURCES = [fitgirl, yts, tpbMovies, eztv, solid, tpbTv, nyaa, subsplease];

const GROUP_ORDER = ["Games", "Movies", "TV", "Anime"];

export function sourcesByGroup() {
  return GROUP_ORDER.map((group) => ({
    group,
    sources: SOURCES.filter((s) => s.group === group),
  })).filter((g) => g.sources.length > 0);
}
