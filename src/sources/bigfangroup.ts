import { decodeWindows1251, encodeWindows1251Query } from "../util/encoding";
import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import { parseSize } from "../util/format";
import { buildMagnet } from "./magnet";
import { unescapeEntities } from "./rss";
import type { SearchOptions, Source, TorrentResult } from "./types";

const BASE = "https://bigfangroup.org";
const MAX_DETAILS = 8;

interface Row {
  name: string;
  id: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
}

export function parseBigfangroupRows(html: string): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const tr of html.split(/<tr[\s>]/i).slice(1)) {
    const link = tr.match(/href="details\.php\?id=(\d+)"[^>]*>\s*<b>([^<]+)<\/b>/i);
    if (!link) continue;
    const id = link[1]!;
    if (seen.has(id)) continue;
    seen.add(id);
    const size = tr.match(/([\d.,]+)\s*(GB|MB|KB|TB)/i)?.[0] ?? "";
    const seeders = Number(
      tr.match(/toseeders=1"[^>]*>\s*(?:<font[^>]*>\s*)?(\d+)/i)?.[1] ?? 0,
    );
    const leechers = Number(tr.match(/todlers=1"[^>]*>\s*(\d+)/i)?.[1] ?? 0);
    out.push({
      id,
      name: unescapeEntities(link[2]!.trim()),
      sizeBytes: parseSize(size.replace(",", ".")),
      seeders,
      leechers,
    });
  }
  return out;
}

export function parseBigfangroupHash(html: string): string | null {
  const plain = html.replace(/<[^>]+>/g, " ");
  const m = plain.match(/Хэш\s*релиза\s*([a-fA-F0-9]{40})/i)
    ?? plain.match(/\b([a-fA-F0-9]{40})\b/);
  return m?.[1]?.toLowerCase() ?? null;
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
  if (!res.ok) throw new HttpError(res.status, `BigFANGroup returned ${res.status}`);
  return decodeWindows1251(await res.arrayBuffer());
}

async function detailHash(id: string, opts: SearchOptions): Promise<string | null> {
  try {
    const html = await fetchText(`${BASE}/details.php?id=${id}`, opts, 1);
    return parseBigfangroupHash(html);
  } catch {
    return null;
  }
}

async function search(query: string, opts: SearchOptions = {}): Promise<TorrentResult[]> {
  const q = query.trim();
  const url = q
    ? `${BASE}/browse.php?search=${encodeWindows1251Query(q)}`
    : `${BASE}/browse.php`;
  const html = await fetchText(url, opts, 2);
  const rows = parseBigfangroupRows(html).slice(0, MAX_DETAILS);
  const settled = await Promise.all(
    rows.map(async (row): Promise<TorrentResult | null> => {
      const infoHash = await detailHash(row.id, opts);
      if (!infoHash) return null;
      return {
        infoHash,
        name: row.name,
        sizeBytes: row.sizeBytes,
        seeders: row.seeders,
        leechers: row.leechers,
        source: "bigfangroup",
        magnet: buildMagnet(infoHash, row.name),
      };
    }),
  );
  return settled.filter((r): r is TorrentResult => r !== null);
}

export const bigfangroup: Source = {
  id: "bigfangroup",
  label: "BigFAN",
  groups: ["Movies", "TV"],
  homepage: "https://bigfangroup.org",
  reportsHealth: true,
  search,
};
