import type { IncomingMessage } from "node:http";
import { envVar } from "../config/env-vars";
import { timingSafeEqual, createHash } from "node:crypto";

/** Optional shared secret for /api/* (set TORZLINK_SERVE_TOKEN). */
export function serveToken(): string | null {
  const t = envVar("TORZLINK_SERVE_TOKEN")?.trim();
  return t && t.length > 0 ? t : null;
}

function safeEqualString(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function extractBearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}

export function authorizeApi(req: IncomingMessage): boolean {
  const expected = serveToken();
  if (!expected) return true;
  const got = extractBearer(req);
  if (!got) return false;
  return safeEqualString(got, expected);
}
