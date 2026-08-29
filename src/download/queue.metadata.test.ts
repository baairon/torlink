import { describe, it, expect, vi } from "vitest";

// What startEngine is handed is the whole point of these two tests, so the
// engine is stubbed to record its `source` argument and the metadata store is
// stubbed to say whether a .torrent exists for an id.
const added: { id: string; source: string }[] = [];

vi.mock("./engine", () => ({
  TorrentEngine: class {
    add(id: string, source: string): void {
      added.push({ id, source });
    }
    remove(): void {}
    stats(): undefined {
      return undefined;
    }
    destroy(): void {}
  },
}));

vi.mock("./persist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./persist")>();
  return {
    ...actual,
    torrentMetaExists: (id: string) => id === "has-meta",
    torrentMetaPath: (id: string) => `/meta/${id}.torrent`,
    saveQueue: async () => {},
    saveSeeds: async () => {},
    saveHistory: async () => {},
  };
});

const { DownloadQueue } = await import("./queue");

const MAGNET = "magnet:?xt=urn:btih:0000000000000000000000000000000000000000";

describe("startEngine source selection", () => {
  /*
   * The difference between seeding and pretending to.
   *
   * A magnet carries no piece hashes, so a client handed one cannot verify a
   * single byte until the swarm sends it metadata. For a torrent created from
   * local content that swarm is empty -- nobody has ever seen this info hash --
   * so it waits forever on data that is already on the disk underneath it.
   * Handed the stored .torrent it verifies locally and completes at once.
   */
  it("prefers a stored .torrent over the magnet", () => {
    added.length = 0;
    const q = new DownloadQueue();
    q.add({ id: "has-meta", name: "local", magnet: MAGNET }, "/data");
    expect(added.at(-1)?.source).toBe("/meta/has-meta.torrent");
  });

  // The ordinary case: nothing downloaded yet, so a magnet is all there is.
  it("falls back to the magnet when there is no stored .torrent", () => {
    added.length = 0;
    const q = new DownloadQueue();
    q.add({ id: "no-meta", name: "remote", magnet: MAGNET }, "/data");
    expect(added.at(-1)?.source).toBe(MAGNET);
  });
});
