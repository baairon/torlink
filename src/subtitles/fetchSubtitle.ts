import { writeFile } from "node:fs/promises";
import { extractSrtFromZip } from "./zip";
import type { SubtitleCandidate } from "./types";

// Subtitle sites block non-browser user agents, so the torlink UA won't do.
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export const FETCH_TIMEOUT_MS = 10_000;

const MAX_BYTES = 2 * 1024 * 1024;

async function readCapped(res: Response): Promise<Buffer | null> {
  const contentLength = res.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BYTES) return null;
  if (!res.body) {
    const ab = await res.arrayBuffer();
    return ab.byteLength > MAX_BYTES ? null : Buffer.from(ab);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      // Abort mid-stream so an oversized body is never fully buffered.
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function downloadSubtitle(
  candidate: SubtitleCandidate,
  destPath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const headers: Record<string, string> = { "user-agent": BROWSER_UA };
    // yifysubtitles.ch returns 403 for zip downloads without the page referer.
    if (new URL(candidate.downloadUrl).host === "yifysubtitles.ch") {
      headers["referer"] = "https://yts-subs.com/";
    }
    const res = await fetchImpl(candidate.downloadUrl, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return false;

    const buf = await readCapped(res);
    if (!buf) return false;

    const isZip = buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
    const text = isZip
      ? extractSrtFromZip(buf, MAX_BYTES)
      : buf.toString("utf8").replace(/^\uFEFF/, "");
    if (!text || !text.includes("-->")) return false;

    // "wx" so a subtitle the user already has (or edited) is never clobbered.
    await writeFile(destPath, text, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}
