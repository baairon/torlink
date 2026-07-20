import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import { buildMagnet } from "./magnet";
import type { SearchOptions, Source, TorrentResult } from "./types";

const API = "https://eztvx.to/api/get-torrents";

interface EztvTorrent {
  title?: string;
  filename?: string;
  hash?: string;
  magnet_url?: string;
  seeds?: number;
  peers?: number;
  size_bytes?: string | number;
  date_released_unix?: number;
}
interface EztvResponse {
  torrents?: EztvTorrent[];
}

// The EZTV API has no keyword endpoint (only imdb_id lookups), so a typed
// query is answered by filtering the latest releases client-side against
// title and filename. Browse (empty query) returns the page as-is.
async function search(query: string, opts: SearchOptions = {}): Promise<TorrentResult[]> {
  const res = await fetchResilient(`${API}?limit=100&page=1`, {
    headers: { "User-Agent": USER_AGENT },
    signal: opts.signal,
    retries: 1,
  });
  if (!res.ok) throw new HttpError(res.status, `EZTV returned ${res.status}`);

  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const json = (await res.json()) as EztvResponse;
  const out: TorrentResult[] = [];
  for (const t of json.torrents ?? []) {
    const hash = (t.hash ?? "").toLowerCase();
    const name = t.title || t.filename || hash;
    if (tokens.length > 0) {
      const haystack = `${t.title ?? ""}\n${t.filename ?? ""}`.toLowerCase();
      if (!tokens.every((tok) => haystack.includes(tok))) continue;
    }
    const magnet = t.magnet_url || (hash ? buildMagnet(hash, name) : "");
    if (!magnet || !hash) continue;
    out.push({
      infoHash: hash,
      name,
      sizeBytes: Number(t.size_bytes ?? 0) || 0,
      seeders: t.seeds ?? 0,
      leechers: t.peers ?? 0,
      source: "eztv",
      magnet,
      added: t.date_released_unix,
    });
  }
  return out;
}

export const eztv: Source = {
  id: "eztv",
  label: "EZTV",
  groups: ["TV"],
  homepage: "https://eztvx.to",
  reportsHealth: true,
  search,
};
