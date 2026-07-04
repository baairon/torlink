import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import { parseMagnet } from "./magnet";
import type { SearchOptions, Source, TorrentResult } from "./types";

const API = "https://subsplease.org/api/";
const RES_PREFERENCE = ["1080", "720", "480"];

interface SpDownload {
  res?: string;
  magnet?: string;
}
interface SpEntry {
  show?: string;
  episode?: string;
  release_date?: string;
  downloads?: SpDownload[];
}

function pickBest(downloads: SpDownload[]): SpDownload | undefined {
  for (const res of RES_PREFERENCE) {
    const d = downloads.find((d) => d.res === res && d.magnet);
    if (d) return d;
  }
  return downloads.find((d) => d.magnet);
}

async function search(query: string, opts: SearchOptions = {}): Promise<TorrentResult[]> {
  const q = query.trim();
  const params = new URLSearchParams({ tz: "UTC" });
  if (q) {
    params.set("f", "search");
    params.set("s", q);
  } else {
    params.set("f", "latest");
  }

  const res = await fetchResilient(`${API}?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: opts.signal,
  });
  if (!res.ok) throw new HttpError(res.status, `SubsPlease returned ${res.status}`);

  const json = (await res.json()) as Record<string, SpEntry> | unknown[];
  if (!json || Array.isArray(json)) return [];

  const out: TorrentResult[] = [];
  for (const entry of Object.values(json)) {
    const dl = pickBest(entry.downloads ?? []);
    if (!dl?.magnet) continue;
    const parsed = parseMagnet(dl.magnet);
    if (!parsed) continue;
    const show = entry.show ?? "Unknown";
    const ep = entry.episode ? ` - ${entry.episode}` : "";
    const sizeMatch = dl.magnet.match(/[?&]xl=(\d+)/);
    out.push({
      infoHash: parsed.infoHash,
      name: `${show}${ep} [${dl.res ?? "?"}p]`,
      sizeBytes: sizeMatch ? Number(sizeMatch[1]) : 0,
      seeders: 0,
      leechers: 0,
      source: "subsplease",
      magnet: parsed.magnet,
      added: entry.release_date ? new Date(entry.release_date).getTime() / 1000 : undefined,
    });
  }
  return out;
}

export const subsplease: Source = {
  id: "subsplease",
  label: "SubsPlease",
  group: "Anime",
  homepage: "https://subsplease.org",
  search,
};
