import type { DelugeConfig } from "../config/config";
import type { FetchImpl } from "../util/net";
import type { DelugeSendResult } from "./types";

const TIMEOUT_MS = 8000;

interface RpcResponse {
  result?: unknown;
  error?: { message?: string };
}

function sessionCookie(res: Response): string | undefined {
  const raw = res.headers.get("set-cookie");
  return raw?.split(";")[0];
}

async function rpc(
  url: string,
  method: string,
  params: unknown[],
  fetchImpl: FetchImpl,
  cookie?: string,
): Promise<{ res: Response; body: RpcResponse }> {
  const res = await fetchImpl(`${url}/json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ method, params, id: 1 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json()) as RpcResponse;
  return { res, body };
}

export interface SendMagnetOptions {
  fetchImpl?: FetchImpl;
}

export async function sendMagnet(
  config: DelugeConfig | null,
  magnet: string,
  opts: SendMagnetOptions = {},
): Promise<DelugeSendResult> {
  if (!config) {
    return { ok: false, reason: "not-configured", message: "Deluge is not configured." };
  }
  const fetchImpl = opts.fetchImpl ?? (fetch as FetchImpl);

  try {
    const login = await rpc(config.url, "auth.login", [config.password], fetchImpl);
    if (login.body.result !== true) {
      return { ok: false, reason: "auth-failed", message: "Deluge login failed." };
    }
    const cookie = sessionCookie(login.res);

    const add = await rpc(config.url, "core.add_torrent_magnet", [magnet, {}], fetchImpl, cookie);
    if (add.body.error) {
      const message = add.body.error.message ?? "Deluge rejected the torrent.";
      if (message.toLowerCase().includes("already in session")) {
        return { ok: true, status: "already-added" };
      }
      return { ok: false, reason: "error", message };
    }
    return { ok: true, status: "added" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: "unreachable", message: `Deluge unreachable: ${message}` };
  }
}
