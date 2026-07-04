import { createContext, useContext } from "react";
import type { Config } from "../config/config";
import type { SourceGroup, SourceId } from "../sources/types";

export type View = "splash" | "browser";

export type Category = "all" | "games" | "movies" | "tv" | "anime";

export type Section = Category;

export const CATEGORIES: { key: Category; label: string; group?: SourceGroup }[] = [
  { key: "all", label: "All" },
  { key: "games", label: "Games", group: "Games" },
  { key: "movies", label: "Movies", group: "Movies" },
  { key: "tv", label: "TV", group: "TV" },
  { key: "anime", label: "Anime", group: "Anime" },
];

export type Region = "sidebar" | "content" | "help";

export type CaptureMode = "none" | "text" | "esc";

export interface Store {
  config: Config;
  setConfig: (c: Config) => void;

  view: View;
  setView: (v: View) => void;
  query: string;
  submitQuery: (q: string) => void;

  section: Section;
  setSection: (s: Section) => void;
  region: Region;
  setRegion: (r: Region) => void;
  captureMode: CaptureMode;
  setCaptureMode: (m: CaptureMode) => void;

  sendToDeluge: (input: {
    id: string;
    name: string;
    magnet: string;
    source?: SourceId;
    sizeBytes?: number;
  }) => void;
  copyMagnet: (input: { name: string; magnet: string }) => void;

  notice: string | null;
  setNotice: (s: string | null) => void;

  quitAll: () => void;

  listRows: number;
  compact: boolean;
  contentWidth: number;
  cols: number;
  rows: number;
}

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("Store not available");
  return s;
}
