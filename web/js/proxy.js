import { fetchTimeout } from "./fetch.js";

const STORAGE_KEY = "torlink.corsProxies";
const DEFAULT_PROXIES = ["https://api.allorigins.win/raw?url="];

export function getProxyList() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_PROXIES;
  } catch {
    return DEFAULT_PROXIES;
  }
}

export function setProxyList(prefixes) {
  const list = prefixes.map((p) => p.trim()).filter(Boolean);
  if (list.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  else localStorage.removeItem(STORAGE_KEY);
}

export function resetProxyList() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function fetchViaProxies(targetUrl) {
  const prefixes = getProxyList();
  const errors = [];
  for (const prefix of prefixes) {
    try {
      const res = await fetchTimeout(prefix + encodeURIComponent(targetUrl));
      if (res.ok) return res;
      errors.push(`${prefix}: HTTP ${res.status}`);
    } catch (err) {
      errors.push(`${prefix}: ${err.message || err}`);
    }
  }
  throw new Error(`All proxies failed — ${errors.join("; ")}`);
}

export { DEFAULT_PROXIES };
