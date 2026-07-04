import { fetchWordpressRss } from "./rss";
import type { Source } from "./types";

const HOME = "https://fitgirl-repacks.site";

export const fitgirl: Source = {
  id: "fitgirl",
  label: "FitGirl",
  group: "Games",
  homepage: HOME,
  search: (query, opts) => fetchWordpressRss(HOME, "fitgirl", query, opts),
};
