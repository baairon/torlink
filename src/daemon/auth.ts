// Shared request guards for the headless HTTP servers (serve, files). Both
// speak plain node:http on a local port, so they share the same two doors:
// a bearer token and, when tokenless, a loopback-only Host header.

export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

// Constant-ish comparison — the token isn't a password hash, but don't leak
// length via early exit on the common prefix.
function tokenMatches(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

export function isAuthorized(token: string | null, authHeader: string | undefined): boolean {
  if (!token) return true; // no token configured -> open (loopback only, enforced at bind)
  if (!authHeader) return false;
  const bearer = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const provided = bearer ? bearer[1]!.trim() : authHeader.trim();
  return tokenMatches(token, provided);
}

// A tokenless server only ever binds loopback, but DNS rebinding lets a hostile
// webpage reach loopback ports through the browser: the request arrives with
// the attacker's name in the Host header. Requiring a loopback Host defeats it.
export function hostHeaderOk(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const raw = hostHeader.trim().toLowerCase();
  let name: string;
  if (raw.startsWith("[")) {
    // bracketed IPv6, e.g. [::1]:9161
    const end = raw.indexOf("]");
    if (end === -1) return false;
    name = raw.slice(1, end);
  } else {
    const colon = raw.indexOf(":");
    name = colon === -1 ? raw : raw.slice(0, colon);
  }
  return LOOPBACK_HOSTS.has(name);
}
