import { describe, it, expect } from "vitest";
import {
  helpEmbed,
  searchEmbed,
  searchComponents,
  statusEmbed,
  addedEmbed,
  SELECT_ADD_ID,
  PAGE_NEXT_ID,
} from "./embeds";
import type { TorrentResult } from "../sources/types";

const r = (over: Partial<TorrentResult>): TorrentResult => ({
  infoHash: "hash1",
  name: "Big Buck Bunny",
  sizeBytes: 5_000_000,
  seeders: 42,
  leechers: 0,
  source: "yts",
  magnet: "magnet:?xt=urn:btih:hash1",
  ...over,
});

describe("helpEmbed", () => {
  it("documents slash commands, not the old ! syntax", () => {
    const e = helpEmbed();
    expect(e.description).toContain("/search");
    expect(e.description).not.toContain("!");
  });
});

describe("searchEmbed", () => {
  it("shows the category and a page footer", () => {
    const e = searchEmbed("matrix", [r({})], 30, 0, "Movies", 0, 3);
    expect(e.title).toContain("Movies");
    expect(e.title).toContain("matrix");
    expect(e.footer?.text).toContain("Page 1/3");
    expect(e.footer?.text).toContain("30 results");
  });
  it("handles an empty result set", () => {
    expect(searchEmbed("zzz", [], 0, 0, undefined, 0, 1).description).toContain("No results");
  });
});

describe("searchComponents", () => {
  it("builds a dropdown whose values are info hashes", () => {
    const rows = searchComponents([r({ infoHash: "abc" })], 0, 0, 1) as { components: { type: number; custom_id?: string; options?: { value: string }[] }[] }[];
    const select = rows[0]!.components[0]!;
    expect(select.type).toBe(3);
    expect(select.custom_id).toBe(SELECT_ADD_ID);
    expect(select.options?.[0]?.value).toBe("abc");
  });
  it("omits the pager on a single page and disables ends on multi-page", () => {
    expect(searchComponents([r({})], 0, 0, 1)).toHaveLength(1); // dropdown only
    const rows = searchComponents([r({})], 0, 0, 3) as { components: { custom_id?: string; disabled?: boolean }[] }[];
    expect(rows).toHaveLength(2);
    const buttons = rows[1]!.components;
    expect(buttons.find((b) => b.custom_id === "torlnk:prev")?.disabled).toBe(true); // first page
    expect(buttons.find((b) => b.custom_id === PAGE_NEXT_ID)?.disabled).toBe(false);
  });
});

describe("statusEmbed", () => {
  it("says so when idle", () => {
    expect(statusEmbed([], []).description).toContain("Nothing downloading");
  });
  it("draws a progress bar for an active download", () => {
    const e = statusEmbed([{ name: "Movie", status: "downloading", progress: 50 }], []);
    expect(e.description).toContain("▰");
    expect(e.description).toContain("50%");
  });
});

describe("addedEmbed", () => {
  it("distinguishes added, duplicate, and invalid", () => {
    expect(addedEmbed("added", "X").title).toContain("Download started");
    expect(addedEmbed("duplicate", "X").title).toContain("Already in the queue");
    expect(addedEmbed("invalid", "X").title).toContain("Couldn't add");
  });
});
