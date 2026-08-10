import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import { parseSize } from "../util/format";
import { unescapeEntities } from "./rss";
import type { SearchOptions, Source, TorrentResult } from "./types";

const HOSTS = ["rutor.info", "rutor.is", "alt.rutor.info", "tracker.rutor.info"];
let workingHostIndex = 0;

const MONTHS: Record<string, number> = {
  янв: 0,
  фев: 1,
  мар: 2,
  апр: 3,
  май: 4,
  июн: 5,
  июл: 6,
  авг: 7,
  сен: 8,
  окт: 9,
  ноя: 10,
  дек: 11,
};

export function parseRutorDate(raw: string): number | undefined {
  const m = raw
    .replace(/\u00a0/g, " ")
    .trim()
    .match(/^(\d{1,2})\s+([А-Яа-яA-Za-z]{3})\s+(\d{2})$/u);
  if (!m) return undefined;
  const month = MONTHS[m[2]!.toLowerCase().slice(0, 3)];
  if (month === undefined) return undefined;
  const day = Number(m[1]);
  const year = 2000 + Number(m[3]);
  const secs = Math.floor(Date.UTC(year, month, day) / 1000);
  return Number.isNaN(secs) ? undefined : secs;
}

export function parseRutorResults(html: string): TorrentResult[] {
  const out: TorrentResult[] = [];
  for (const tr of html.split(/<tr[^>]*class="(?:gai|tum)"[^>]*>/i).slice(1)) {
    const magnetRaw = tr.match(/href="(magnet:\?xt=urn:btih:[^"]+)"/i)?.[1];
    if (!magnetRaw) continue;
    const magnet = unescapeEntities(magnetRaw);
    const infoHash = magnet.match(/urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i)?.[1]?.toLowerCase();
    if (!infoHash) continue;
    const name = unescapeEntities(
      tr.match(/href="\/torrent\/[^"]+"[^>]*>([^<]+)<\/a>/i)?.[1]?.trim() ?? infoHash,
    );
    const size = tr.match(/([\d.,]+)\s*(?:&nbsp;|\s)*(GB|MB|KB|TB)/i);
    const sizeBytes = size ? parseSize(`${size[1]!.replace(",", ".")} ${size[2]}`) : 0;
    const seeders = Number(tr.match(/alt="S"[^>]*(?:\/?>)(?:&nbsp;|\s)*(\d+)/i)?.[1] ?? 0);
    const leechers = Number(tr.match(/alt="L"[^>]*(?:\/?>)[\s\S]*?(?:&nbsp;|\s)*(\d+)/i)?.[1] ?? 0);
    const dateRaw = unescapeEntities(tr.match(/<td>([^<]+)<\/td>/i)?.[1] ?? "");
    out.push({
      infoHash,
      name,
      sizeBytes,
      seeders,
      leechers,
      source: "rutor",
      magnet,
      added: parseRutorDate(dateRaw),
    });
  }
  return out;
}

async function fetchText(url: string, opts: SearchOptions, retries: number): Promise<string> {
  const res = await fetchResilient(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: opts.signal,
    retries,
  });
  if (!res.ok) throw new HttpError(res.status, `Rutor returned ${res.status}`);
  return res.text();
}

async function search(query: string, opts: SearchOptions = {}): Promise<TorrentResult[]> {
  const q = query.trim();
  const path = q
    ? `/search/0/0/000/0/${encodeURIComponent(q)}`
    : "/";

  let html = "";
  let lastError: unknown;
  for (let i = 0; i < HOSTS.length; i++) {
    const hostIdx = (workingHostIndex + i) % HOSTS.length;
    const host = HOSTS[hostIdx]!;
    try {
      html = await fetchText(`https://${host}${path}`, opts, i === 0 ? 2 : 0);
      workingHostIndex = hostIdx;
      break;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      lastError = e;
    }
  }
  if (!html) throw lastError instanceof Error ? lastError : new HttpError(0, "Rutor unreachable");
  return parseRutorResults(html);
}

export const rutor: Source = {
  id: "rutor",
  label: "Rutor",
  groups: ["Movies", "TV", "Anime"],
  homepage: "https://rutor.info",
  reportsHealth: true,
  search,
};
