import { describe, it, expect } from "vitest";
import os from "node:os";
import { executeCommand, pageSearch, addByInfoHash, newUserState } from "./execute";
import type { Runtime } from "../daemon/runtime";
import type { TorrentResult } from "../sources/types";

const HASH = "abcdef0123456789abcdef0123456789abcdef01";
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=Big+Buck+Bunny`;

function fakeRuntime(): { runtime: Runtime; items: { id: string; name: string; status: string; progress: number }[] } {
  const items: { id: string; name: string; status: string; progress: number }[] = [];
  const queue = {
    has: (id: string) => items.some((i) => i.id === id),
    add: (input: { id: string; name: string }) =>
      items.push({ id: input.id, name: input.name, status: "downloading", progress: 0 }),
    getItems: () => items,
    getSeeds: () => [] as unknown[],
    cancel: (id: string) => {
      const idx = items.findIndex((i) => i.id === id);
      if (idx >= 0) items.splice(idx, 1);
    },
  };
  return { runtime: { queue, downloadDir: os.tmpdir() } as unknown as Runtime, items };
}

const result = (over: Partial<TorrentResult>): TorrentResult => ({
  infoHash: HASH,
  name: "Big Buck Bunny",
  sizeBytes: 5_000_000,
  seeders: 42,
  leechers: 1,
  source: "yts",
  magnet: MAGNET,
  ...over,
});

const searchStub = (list: TorrentResult[]) => async () => list;

describe("executeCommand", () => {
  it("returns the help embed with slash syntax", async () => {
    const { runtime } = fakeRuntime();
    const reply = await executeCommand({ kind: "help" }, runtime, newUserState());
    expect(reply.embeds[0]!.description).toContain("/search");
    expect(reply.embeds[0]!.description).not.toContain("!search");
  });

  it("searches, stores results, and offers a dropdown", async () => {
    const { runtime } = fakeRuntime();
    const state = newUserState();
    const reply = await executeCommand({ kind: "search", query: "bunny" }, runtime, state, {
      search: searchStub([result({})]),
    });
    expect(state.search?.results).toHaveLength(1);
    expect(reply.components).toBeDefined();
    expect(reply.embeds[0]!.title).toContain("bunny");
  });

  it("adds the chosen result by number, then reports duplicates", async () => {
    const { runtime, items } = fakeRuntime();
    const state = newUserState();
    await executeCommand({ kind: "search", query: "bunny" }, runtime, state, { search: searchStub([result({})]) });

    const added = await executeCommand({ kind: "add", arg: "1" }, runtime, state);
    expect(added.embeds[0]!.title).toContain("Download started");
    expect(items).toHaveLength(1);

    const again = await executeCommand({ kind: "add", arg: "1" }, runtime, state);
    expect(again.embeds[0]!.title).toContain("Already in the queue");
  });

  it("rejects an out-of-range add", async () => {
    const { runtime } = fakeRuntime();
    const reply = await executeCommand({ kind: "add", arg: "3" }, runtime, newUserState());
    expect(reply.embeds[0]!.description).toContain("No result #3");
  });

  it("adds a raw magnet", async () => {
    const { runtime, items } = fakeRuntime();
    const reply = await executeCommand({ kind: "add", arg: MAGNET }, runtime, newUserState());
    expect(reply.embeds[0]!.title).toContain("Download started");
    expect(items).toHaveLength(1);
  });

  it("lists status and cancels by number", async () => {
    const { runtime, items } = fakeRuntime();
    const state = newUserState();
    await executeCommand({ kind: "add", arg: MAGNET }, runtime, state);

    const status = await executeCommand({ kind: "status" }, runtime, state);
    expect(status.embeds[0]!.description).toContain("Big Buck Bunny");

    const cancel = await executeCommand({ kind: "cancel", arg: "1" }, runtime, state);
    expect(cancel.embeds[0]!.title).toContain("Cancelled");
    expect(items).toHaveLength(0);
  });
});

describe("pagination", () => {
  // Real magnets so addInput derives the same id the result advertises.
  const hex = (i: number) => i.toString(16).padStart(40, "0");
  const many = Array.from({ length: 23 }, (_, i) =>
    result({ infoHash: hex(i), name: `Result ${i + 1}`, magnet: `magnet:?xt=urn:btih:${hex(i)}&dn=Result${i + 1}` }),
  );

  it("pages through results with clamped bounds and global numbering", async () => {
    const { runtime } = fakeRuntime();
    const state = newUserState();
    const p1 = await executeCommand({ kind: "search", query: "x" }, runtime, state, { search: searchStub(many) });
    expect(p1.embeds[0]!.footer?.text).toContain("Page 1/3");
    expect(p1.embeds[0]!.description).toContain("**1.**");
    expect(p1.embeds[0]!.description).toContain("**10.**");

    const p2 = pageSearch(state, 1)!;
    expect(p2.embeds[0]!.description).toContain("**11.**");
    expect(p2.embeds[0]!.footer?.text).toContain("Page 2/3");

    pageSearch(state, 1); // to page 3
    const overshoot = pageSearch(state, 1)!; // clamp at last
    expect(overshoot.embeds[0]!.footer?.text).toContain("Page 3/3");
  });

  it("adds a result from a later page by its info hash (dropdown pick)", async () => {
    const { runtime, items } = fakeRuntime();
    const state = newUserState();
    await executeCommand({ kind: "search", query: "x" }, runtime, state, { search: searchStub(many) });
    const reply = await addByInfoHash(hex(15), runtime, state);
    expect(reply.embeds[0]!.title).toContain("Download started");
    expect(items[0]!.id).toBe(hex(15));
  });
});
