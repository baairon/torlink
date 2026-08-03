import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { addInput, type Runtime } from "./runtime";

const HASH = "abcdef0123456789abcdef0123456789abcdef01";
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=Example`;

// A stand-in for DownloadQueue that records adds without spinning up webtorrent.
function fakeRuntime(dir: string, has = false): { runtime: Runtime; add: ReturnType<typeof vi.fn> } {
  const add = vi.fn();
  const runtime = {
    queue: { has: () => has, add } as unknown as Runtime["queue"],
    downloadDir: dir,
  };
  return { runtime, add };
}

describe("addInput", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-rt-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("adds a magnet keyed by its info hash", async () => {
    const { runtime, add } = fakeRuntime(dir);
    expect(await addInput(runtime, MAGNET)).toBe("added");
    expect(add).toHaveBeenCalledWith(
      { id: HASH, name: "Example", magnet: MAGNET },
      dir,
    );
  });

  it("adds a bare info hash", async () => {
    const { runtime, add } = fakeRuntime(dir);
    expect(await addInput(runtime, HASH)).toBe("added");
    expect(add).toHaveBeenCalledOnce();
  });

  it("reports a duplicate without adding", async () => {
    const { runtime, add } = fakeRuntime(dir, true);
    expect(await addInput(runtime, MAGNET)).toBe("duplicate");
    expect(add).not.toHaveBeenCalled();
  });

  it("reports invalid input without adding or throwing", async () => {
    const { runtime, add } = fakeRuntime(dir);
    expect(await addInput(runtime, "not a magnet")).toBe("invalid");
    expect(add).not.toHaveBeenCalled();
  });

  it("rejects a .torrent file path unless the caller opts in", async () => {
    const { runtime, add } = fakeRuntime(dir);
    const file = path.join(dir, "example.torrent");
    expect(await addInput(runtime, file)).toBe("invalid");
    expect(add).not.toHaveBeenCalled();
    // Opted in (the watch folder), a bad file still fails soft as invalid.
    expect(await addInput(runtime, file, { allowTorrentPath: true })).toBe("invalid");
  });
});
