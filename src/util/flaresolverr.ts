import { HttpError } from "./net";

let globalFlareSolverrUrl: string | undefined = undefined;

export function setFlareSolverrUrl(url: string | undefined): void {
  globalFlareSolverrUrl = url && url.trim() ? url.trim() : undefined;
}

export function getFlareSolverrUrl(): string | undefined {
  return globalFlareSolverrUrl;
}

export function isFlareSolverrEnabled(): boolean {
  return Boolean(globalFlareSolverrUrl);
}

export function isCloudflareBlock(res: Response): boolean {
  const server = res.headers.get("server")?.toLowerCase() || "";
  return (
    (res.status === 503 || res.status === 403) &&
    (server.includes("ddos-guard") || server.includes("cloudflare") || res.status === 403)
  );
}

export async function fetchViaFlareSolverr(
  targetUrl: string,
  solverUrl: string,
  signal?: AbortSignal,
): Promise<Response> {
  const payload = {
    cmd: "request.get",
    url: targetUrl,
    maxTimeout: 60000,
  };

  let res: Response;
  try {
    res = await fetch(solverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    throw new HttpError(
      0,
      `FlareSolverr request to ${solverUrl} failed: ${(err as Error).message}. Ensure FlareSolverr is running.`,
    );
  }

  if (!res.ok) {
    throw new HttpError(res.status, `FlareSolverr returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    status?: string;
    message?: string;
    solution?: {
      status?: number;
      response?: string;
    };
  };

  if (data.status !== "ok" || !data.solution) {
    throw new HttpError(0, `FlareSolverr failed to solve challenge: ${data.message || "Unknown error"}`);
  }

  const status = data.solution.status ?? 200;
  const html = data.solution.response ?? "";

  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
