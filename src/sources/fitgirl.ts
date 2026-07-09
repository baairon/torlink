import { fetchWordpressRss } from "./rss";
import type { Source } from "./types";

const HOME = "https://fitgirl-repacks.site";

export const fitgirl: Source = {
  id: "fitgirl",
  label: "FitGirl",
  groups: ["Games"],
  homepage: HOME,
  // WordPress RSS carries no swarm data; every result reports seeders: 0.
  reportsHealth: false,
  search: (query, opts) => fetchWordpressRss(HOME, "fitgirl", query, opts),
};
