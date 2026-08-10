import { decodeWindows1251, encodeWindows1251Query } from "../util/encoding";
import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import { parseSize } from "../util/format";
import { buildMagnet } from "./magnet";
import { unescapeEntities } from "./rss";
import type { SearchOptions, Source, TorrentResult } from "./types";

const BASE = "https://megapeer.vip";
const MAX_DETAILS = 8;

interface Row {
  name: string;
  path: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
}

export function parseMegapeerRows(html: string): Row[] {
  const out: Row[] = [];
  for (const tr of html.split(/<tr[^>]*class="table_fon"[^>]*>/i).slice(1)) {
    const link = tr.match(/href="(\/torrent\/\d+\/[^"]+)"[^>]*class="url"[^>]*>([^<]+)<\/a>/i)
      ?? tr.match(/href="(\/torrent\/\d+\/[^"]+)"[^>]*>([^<]+)<\/a>/i);
    if (!link) continue;
    const size = tr.match(/([\d.,]+)\s*(GB|MB|KB|TB)/i)?.[0] ?? "";
    out.push({
      name: unescapeEntities(link[2]!.trim()),
      path: link[1]!,
      sizeBytes: parseSize(size.replace(",", ".")),
      seeders: Number(tr.match(/alt="S"[^>]*>[\s\S]*?<font[^>]*>\s*(\d+)/i)?.[1] ?? 0),
      leechers: Number(tr.match(/alt="L"[^>]*>[\s\S]*?<font[^>]*>\s*(\d+)/i)?.[1] ?? 0),
    });
  }
  return out;
}

async function fetchText(url: string, opts: SearchOptions, retries: number): Promise<string> {
  const res = await fetchResilient(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html",
    },
    signal: opts.signal,
    retries,
  });
  if (!res.ok) throw new HttpError(res.status, `MegaPeer returned ${res.status}`);
  return decodeWindows1251(await res.arrayBuffer());
}

async function detailMagnet(path: string, opts: SearchOptions): Promise<string | null> {
  try {
    const html = await fetchText(`${BASE}${path}`, opts, 1);
    const raw = html.match(/magnet:\?xt=urn:btih:[^"'<>\s]+/i)?.[0];
    return raw ? unescapeEntities(raw) : null;
  } catch {
    return null;
  }
}

async function search(query: string, opts: SearchOptions = {}): Promise<TorrentResult[]> {
  const q = query.trim();
  const url = q
    ? `${BASE}/browse.php?search=${encodeWindows1251Query(q)}`
    : `${BASE}/alltorrents`;
  const html = await fetchText(url, opts, 2);
  const rows = parseMegapeerRows(html).slice(0, MAX_DETAILS);
  const settled = await Promise.all(
    rows.map(async (row): Promise<TorrentResult | null> => {
      const magnet = await detailMagnet(row.path, opts);
      const infoHash = magnet?.match(/urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i)?.[1]?.toLowerCase();
      if (!magnet || !infoHash) return null;
      return {
        infoHash,
        name: row.name,
        sizeBytes: row.sizeBytes,
        seeders: row.seeders,
        leechers: row.leechers,
        source: "megapeer",
        magnet: magnet.includes("&dn=") ? magnet : buildMagnet(infoHash, row.name),
      };
    }),
  );
  return settled.filter((r): r is TorrentResult => r !== null);
}

export const megapeer: Source = {
  id: "megapeer",
  label: "MegaPeer",
  groups: ["Movies", "TV"],
  homepage: "https://megapeer.vip",
  reportsHealth: true,
  search,
};
