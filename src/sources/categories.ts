import type { SourceGroup } from "./types";

export type Category = "all" | "games" | "movies" | "tv" | "anime";

export const CATEGORIES: { key: Category; label: string; group?: SourceGroup }[] = [
  { key: "all", label: "All" },
  { key: "games", label: "Games", group: "Games" },
  { key: "movies", label: "Movies", group: "Movies" },
  { key: "tv", label: "TV", group: "TV" },
  { key: "anime", label: "Anime", group: "Anime" },
];

export function categoryByKey(key: string | null | undefined): (typeof CATEGORIES)[number] | undefined {
  if (!key) return undefined;
  return CATEGORIES.find((c) => c.key === key);
}

export function parseSourceGroup(raw: string | null | undefined): SourceGroup | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (t === "Games" || t === "Movies" || t === "TV" || t === "Anime") return t;
  const cat = categoryByKey(t.toLowerCase());
  return cat?.group;
}
