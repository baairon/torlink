import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchWordpressRss, unescapeEntities } from "./rss";
import { fetchResilient } from "../util/net";

vi.mock("../util/net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../util/net")>();
  return { ...actual, fetchResilient: vi.fn() };
});

const mockFetch = vi.mocked(fetchResilient);

const item = (hash: string): string =>
  `<item><title>Game ${hash}</title><pubDate>Tue, 30 Jun 2026 00:00:00 +0000</pubDate>` +
  `<a href="magnet:?xt=urn:btih:${hash}&amp;dn=x">magnet</a></item>`;

const newsItem = (title: string): string =>
  `<item><title>${title}</title><pubDate>Tue, 30 Jun 2026 00:00:00 +0000</pubDate></item>`;

const feed = (...items: string[]): string => `<rss><channel>${items.join("")}</channel></rss>`;

const page = (xml: string): Response =>
  ({ ok: true, status: 200, text: async () => xml }) as unknown as Response;

const notFound = (): Response =>
  ({ ok: false, status: 404, text: async () => "" }) as unknown as Response;

const hashes = (n: number, prefix: string): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(39, "0")}`);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("fetchWordpressRss", () => {
  it("fetches a single page when page 1 is not full", async () => {
    mockFetch.mockResolvedValueOnce(page(feed(...hashes(3, "a").map(item))));
    const results = await fetchWordpressRss("https://x.site", "fitgirl", "");
    expect(results).toHaveLength(3);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]![0]).toBe("https://x.site/feed/");
  });

  it("fans out to pages 2 and 3 when page 1 is full, keeping page order", async () => {
    mockFetch
      .mockResolvedValueOnce(page(feed(...hashes(10, "a").map(item))))
      .mockResolvedValueOnce(page(feed(...hashes(10, "b").map(item))))
      .mockResolvedValueOnce(page(feed(...hashes(10, "c").map(item))));
    const results = await fetchWordpressRss("https://x.site", "fitgirl", "");
    expect(results).toHaveLength(30);
    expect(results[0]!.infoHash.startsWith("a")).toBe(true);
    expect(results[29]!.infoHash.startsWith("c")).toBe(true);
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([
      "https://x.site/feed/",
      "https://x.site/feed/?paged=2",
      "https://x.site/feed/?paged=3",
    ]);
  });

  it("counts magnetless news posts toward the full-page check", async () => {
    const first = feed(newsItem("Upcoming Repacks"), newsItem("Updates Digest"), ...hashes(8, "a").map(item));
    mockFetch
      .mockResolvedValueOnce(page(first))
      .mockResolvedValueOnce(page(feed(...hashes(10, "b").map(item))))
      .mockResolvedValueOnce(page(feed()));
    const results = await fetchWordpressRss("https://x.site", "fitgirl", "");
    expect(results).toHaveLength(18);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("tolerates deep-page failures and keeps the rest", async () => {
    mockFetch
      .mockResolvedValueOnce(page(feed(...hashes(10, "a").map(item))))
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(page(feed(...hashes(10, "c").map(item))));
    const results = await fetchWordpressRss("https://x.site", "fitgirl", "");
    expect(results).toHaveLength(20);
  });

  it("dedupes hashes that repeat across pages", async () => {
    const shared = hashes(10, "a");
    mockFetch
      .mockResolvedValueOnce(page(feed(...shared.map(item))))
      .mockResolvedValueOnce(page(feed(...shared.map(item))))
      .mockResolvedValueOnce(page(feed(...hashes(2, "c").map(item))));
    const results = await fetchWordpressRss("https://x.site", "fitgirl", "");
    expect(results).toHaveLength(12);
  });

  it("still throws when page 1 fails", async () => {
    mockFetch.mockResolvedValueOnce(notFound());
    await expect(fetchWordpressRss("https://x.site", "fitgirl", "")).rejects.toThrow("404");
  });

  it("builds search urls with the query and pages with &paged=", async () => {
    mockFetch
      .mockResolvedValueOnce(page(feed(...hashes(10, "a").map(item))))
      .mockResolvedValueOnce(page(feed()))
      .mockResolvedValueOnce(page(feed()));
    await fetchWordpressRss("https://x.site", "fitgirl", "elden ring");
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([
      "https://x.site/?s=elden%20ring&feed=rss2",
      "https://x.site/?s=elden%20ring&feed=rss2&paged=2",
      "https://x.site/?s=elden%20ring&feed=rss2&paged=3",
    ]);
  });
});

describe("unescapeEntities", () => {
  it("unescapes the common wordpress entities", () => {
    expect(unescapeEntities("a &amp; b &#8211; c&#8217;s")).toBe("a & b - c's");
  });
});
