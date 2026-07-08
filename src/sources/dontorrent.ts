import { fetchResilient, HttpError, USER_AGENT } from "../util/net";
import type { SearchOptions, Source, TorrentResult } from "./types";
import { createHash } from "node:crypto";
import parseTorrent from "parse-torrent";
import { buildMagnet } from "./magnet";

export function resolveMirrorHTML(html: string): string {
  const match = html.match(/\[[^\]]+\]\((https?:\/\/[a-zA-Z0-9-.]+(?:\.pm|\.org|\.run|\.wtf|\.cool))\)[^\n]*Proxy Generado/i) 
             || html.match(/href="(https?:\/\/[^"]+)"[^>]*>.*Proxy Generado/i);
             
  if (match && match[1]) {
    return match[1].replace(/\/$/, ""); // trim trailing slash
  }
  throw new Error("Could not find active DonTorrent mirror");
}

export async function resolveMirror(opts: SearchOptions = {}): Promise<string> {
  const res = await fetchResilient("https://donproxies.com", {
    headers: { "User-Agent": USER_AGENT },
    signal: opts.signal,
    retries: 2,
  });
  if (!res.ok) throw new HttpError(res.status, `donproxies returned ${res.status}`);
  const html = await res.text();
  return resolveMirrorHTML(html);
}

export function computeProofOfWork(challenge: string, difficulty: number = 3): number {
  let nonce = 0;
  const target = "0".repeat(difficulty);
  while (true) {
    const text = challenge + nonce;
    const hashHex = createHash("sha256").update(text).digest("hex");
    if (hashHex.startsWith(target)) {
      return nonce;
    }
    nonce++;
  }
}

async function fetchMagnet(
  base: string,
  contentId: number,
  tabla: string,
  opts: SearchOptions,
): Promise<{ magnet: string; infoHash: string; name?: string } | null> {
  try {
    // 1. Generate challenge
    const genRes = await fetchResilient(`${base}/api_validate_pow.php`, {
      method: "POST",
      headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate", content_id: contentId, tabla }),
      signal: opts.signal,
      retries: 1,
    });
    if (!genRes.ok) return null;
    const genData = await genRes.json() as any;
    if (!genData.success || !genData.challenge) return null;

    // 2. Compute PoW
    const nonce = computeProofOfWork(genData.challenge, 3);

    // 3. Validate
    const valRes = await fetchResilient(`${base}/api_validate_pow.php`, {
      method: "POST",
      headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "validate", challenge: genData.challenge, nonce }),
      signal: opts.signal,
      retries: 1,
    });
    if (!valRes.ok) return null;
    const valData = await valRes.json() as any;
    
    // Si pide captcha o rate limit, abortamos este silenciosamente.
    if (!valData.success || !valData.download_url) return null;

    const downloadUrl = valData.download_url.startsWith("http") 
      ? valData.download_url 
      : `${base}${valData.download_url.startsWith("/") ? "" : "/"}${valData.download_url}`;

    // 4. Download torrent file
    const torRes = await fetchResilient(downloadUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: opts.signal,
      retries: 1,
    });
    if (!torRes.ok) return null;
    const buf = await torRes.arrayBuffer();
    
    // 5. Parse
    const parsed = await parseTorrent(new Uint8Array(buf));
    const infoHash = parsed?.infoHash?.toLowerCase();
    if (!infoHash) return null;
    const name = parsed.name || infoHash;
    let magnet = buildMagnet(infoHash, name);
    
    // Preserve custom/private trackers from the original .torrent file
    const originalTrackers = parsed.announce || [];
    for (const tr of originalTrackers) {
      if (typeof tr === "string" && tr.trim() !== "") {
        magnet += `&tr=${encodeURIComponent(tr.trim())}`;
      }
    }
    
    return { magnet, infoHash, name };
  } catch (e) {
    return null;
  }
}

export function parseRows(html: string): { name: string; url: string; category: string }[] {
  const out = [];
  const regex = /<a href=['"]([^'"]+)['"][^>]*>(.*?)<\/a>.*?<span[^>]*badge[^>]*>([^<]+)<\/span>/ig;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const url = m[1] as string;
    const name = (m[2] as string).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const category = (m[3] as string).trim();
    if (url.match(/^\/(pelicula|serie|documental)s?\/\d+\//i)) {
      out.push({ url, name, category });
    }
  }
  return out;
}

export function inferContent(url: string): { contentId: number; tabla: string } | null {
  const m = url.match(/^\/(pelicula|serie|documental)s?\/(?:hd\/|4k\/)?(\d+)\//i);
  if (!m) return null;
  const type = (m[1] as string).toLowerCase();
  const contentId = parseInt(m[2] as string, 10);
  let tabla = "";
  if (type === "pelicula") tabla = "peliculas";
  else if (type === "serie") tabla = "series";
  else if (type === "documental") tabla = "documentales";
  else return null;
  
  return { contentId, tabla };
}

const MAX_DETAILS = 8;

async function search(
  query: string,
  group: "Movies" | "TV",
  source: string,
  opts: SearchOptions = {},
): Promise<TorrentResult[]> {
  const q = query.trim();
  if (!q) return [];

  const base = await resolveMirror(opts);
  
  const searchUrl = `${base}/buscar`;
  const res = await fetchResilient(searchUrl, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: `valor=${encodeURIComponent(q)}`,
    signal: opts.signal,
    retries: 1,
  });

  if (!res.ok) throw new HttpError(res.status, `DonTorrent returned ${res.status}`);
  const html = await res.text();
  
  const allRows = parseRows(html);
  
  const isMovieGroup = group === "Movies";
  const rows = allRows.filter(r => {
    const cat = r.category.toLowerCase();
    if (isMovieGroup) {
      return cat.includes("película") || cat.includes("documental");
    } else {
      return cat.includes("serie");
    }
  }).slice(0, MAX_DETAILS);
  
  const settled = await Promise.all(
    rows.map(async (row): Promise<TorrentResult | null> => {
      const content = inferContent(row.url);
      if (!content) return null;
      
      const parsed = await fetchMagnet(base, content.contentId, content.tabla, opts);
      if (!parsed) return null;
      
      return {
        infoHash: parsed.infoHash,
        name: parsed.name || row.name,
        sizeBytes: 0,
        seeders: 100, // Placeholder as search doesn't return seeders
        leechers: 0,
        source: source as any,
        magnet: parsed.magnet,
      };
    })
  );
  
  return settled.filter((r): r is TorrentResult => r !== null);
}

export const dontorrentMovies: Source = {
  id: "dontorrent-movies" as any,
  label: "DonTorrent",
  group: "Movies",
  homepage: "https://donproxies.com",
  search: (query, opts) => search(query, "Movies", "dontorrent-movies", opts),
};

export const dontorrentTv: Source = {
  id: "dontorrent-tv" as any,
  label: "DonTorrent",
  group: "TV",
  homepage: "https://donproxies.com",
  search: (query, opts) => search(query, "TV", "dontorrent-tv", opts),
};
