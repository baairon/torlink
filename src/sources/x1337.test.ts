import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseUploadDate, x1337Movies, x1337Tv, x1337Music } from "./x1337";
import { fetchResilient } from "../util/net";

vi.mock("../util/net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../util/net")>();
  return { ...actual, fetchResilient: vi.fn() };
});

const mockFetch = vi.mocked(fetchResilient);

const detail = (span: string) =>
  `<ul class="list"><li><strong>Date uploaded</strong><span>${span}</span> </li></ul>`;

describe("parseUploadDate", () => {
  it("parses the 'Mon. Dayth \\'YY' format to a UTC unix timestamp", () => {
    const ts = parseUploadDate(detail("Jun. 26th  '26"));
    expect(ts).toBe(Math.floor(Date.UTC(2026, 5, 26) / 1000));
  });

  it("handles single-digit days and other ordinals", () => {
    expect(parseUploadDate(detail("Jan. 1st '24"))).toBe(Math.floor(Date.UTC(2024, 0, 1) / 1000));
    expect(parseUploadDate(detail("Mar. 3rd '25"))).toBe(Math.floor(Date.UTC(2025, 2, 3) / 1000));
    expect(parseUploadDate(detail("Dec. 22nd '23"))).toBe(Math.floor(Date.UTC(2023, 11, 22) / 1000));
  });

  it("returns undefined when the field is missing or unparseable", () => {
    expect(parseUploadDate("<div>no date here</div>")).toBeUndefined();
    expect(parseUploadDate(detail("sometime"))).toBeUndefined();
  });
});

const listPage = (rows: { path: string; name: string; seeds: number }[]): string =>
  `<table class="table-list">` +
  rows
    .map(
      (r) =>
        `<tr><td class="coll-1"><a href="${r.path}">${r.name}</a></td>` +
        `<td class="coll-2 seeds">${r.seeds}</td><td class="coll-3 leeches">1</td>` +
        `<td class="coll-4 size mob">1.2 GB</td></tr>`,
    )
    .join("") +
  `</table>`;

const detailPage = `<a href="magnet:?xt=urn:btih:${"c".repeat(40)}&dn=x">magnet</a>`;

const html = (body: string): Response =>
  ({ ok: true, status: 200, text: async () => body }) as unknown as Response;

// Serve by URL shape so a stray extra request can never exhaust the mock and
// push the module's host rotation off the first mirror mid-suite.
const serveList = (body: string): void => {
  mockFetch.mockImplementation(async (url: string) =>
    url.includes("/torrent/") ? html(detailPage) : html(body),
  );
};

const askedPath = (call: number): string =>
  new URL(String(mockFetch.mock.calls[call]![0])).pathname;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("x1337Music", () => {
  it("feeds Music only, never the video tabs", () => {
    expect(x1337Music.id).toBe("x1337-music");
    expect(x1337Music.groups).toEqual(["Music"]);
    expect(x1337Music.reportsHealth).toBe(true);
  });

  it("browses /popular-music when the query is empty", async () => {
    serveList(listPage([{ path: "/torrent/1/a/", name: "Some Album FLAC", seeds: 9 }]));
    const results = await x1337Music.search("");
    expect(askedPath(0)).toBe("/popular-music");
    expect(results.map((r) => r.source)).toEqual(["x1337-music"]);
    expect(results[0]!.magnet).toContain("magnet:?xt=urn:btih:");
  });

  it("searches through /category-search with the query plus-joined and Music as the category", async () => {
    serveList(listPage([{ path: "/torrent/2/b/", name: "Daft Punk Discovery", seeds: 5 }]));
    const results = await x1337Music.search("daft punk");
    expect(askedPath(0)).toBe("/category-search/daft+punk/Music/1/");
    expect(results.map((r) => r.name)).toEqual(["Daft Punk Discovery"]);
  });
});

// The slug map replaced a Movies/TV ternary; these pin that the two existing
// tabs still ask for the same pages they always did.
describe("x1337 browse slugs", () => {
  it("keeps Movies on /popular-movies", async () => {
    serveList(listPage([]));
    await x1337Movies.search("");
    expect(askedPath(0)).toBe("/popular-movies");
  });

  it("keeps TV on /popular-tv", async () => {
    serveList(listPage([]));
    await x1337Tv.search("");
    expect(askedPath(0)).toBe("/popular-tv");
  });
});
