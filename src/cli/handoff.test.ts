import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { claim, parseHandoff, type Handoff, type Inbox } from "./handoff";

const HASH = "abcdef0123456789abcdef0123456789abcdef01";
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=Example`;

let serial = 0;
function endpoint(): string {
  serial++;
  if (process.platform === "win32") return `\\\\.\\pipe\\torlink-test-${process.pid}-${serial}`;
  return path.join(mkdtempSync(path.join(os.tmpdir(), "torlink-handoff-")), "h.sock");
}

const open: Inbox[] = [];
async function own(target: string): Promise<Inbox> {
  const result = await claim(undefined, target);
  if (result === "sent" || result === null) throw new Error("expected to own the endpoint");
  open.push(result);
  return result;
}

function next(inbox: Inbox): Promise<Handoff> {
  return new Promise((resolve) => inbox.subscribe(resolve));
}

// Write raw bytes the way a launch would, bypassing claim's own framing.
function raw(target: string, body: string): Promise<void> {
  return new Promise((resolve) => {
    const sock = net.connect(target, () => sock.end(body));
    sock.on("error", () => {});
    sock.once("close", () => resolve());
  });
}

afterEach(() => {
  for (const inbox of open.splice(0)) inbox.close();
});

describe("parseHandoff", () => {
  it("reads a magnet or a torrent path", () => {
    expect(parseHandoff(JSON.stringify({ magnet: MAGNET }))).toEqual({ magnet: MAGNET });
    expect(parseHandoff(JSON.stringify({ torrent: "/tmp/a.torrent" }))).toEqual({
      torrent: "/tmp/a.torrent",
    });
  });
  it("rejects anything else", () => {
    expect(parseHandoff("")).toBeNull();
    expect(parseHandoff("{bad json")).toBeNull();
    expect(parseHandoff("null")).toBeNull();
    expect(parseHandoff(`{"magnet":""}`)).toBeNull();
    expect(parseHandoff(`{"torrent":7}`)).toBeNull();
  });
});

describe("claim", () => {
  it("becomes the owner when nothing is listening, even with a launch", async () => {
    const result = await claim({ magnet: MAGNET }, endpoint());
    expect(result).not.toBe("sent");
    expect(result).not.toBeNull();
    if (result && result !== "sent") open.push(result);
  });

  it("hands a later launch to the owner", async () => {
    const target = endpoint();
    const inbox = await own(target);
    const got = next(inbox);
    expect(await claim({ torrent: "/tmp/a.torrent" }, target)).toBe("sent");
    expect(await got).toEqual({ torrent: "/tmp/a.torrent" });
  });

  it("holds a handoff that arrives before anyone subscribes", async () => {
    const target = endpoint();
    const inbox = await own(target);
    expect(await claim({ magnet: MAGNET }, target)).toBe("sent");
    expect(await next(inbox)).toEqual({ magnet: MAGNET });
  });

  it("delivers several handoffs in the order they arrived", async () => {
    const target = endpoint();
    const inbox = await own(target);
    await claim({ torrent: "/tmp/a.torrent" }, target);
    await claim({ torrent: "/tmp/b.torrent" }, target);
    const seen: Handoff[] = [];
    inbox.subscribe((msg) => seen.push(msg));
    expect(seen).toEqual([{ torrent: "/tmp/a.torrent" }, { torrent: "/tmp/b.torrent" }]);
  });

  it("leaves a plain second launch without an inbox and the owner intact", async () => {
    const target = endpoint();
    const inbox = await own(target);
    expect(await claim(undefined, target)).toBeNull();
    const got = next(inbox);
    expect(await claim({ magnet: MAGNET }, target)).toBe("sent");
    expect(await got).toEqual({ magnet: MAGNET });
  });

  it("drops malformed and oversized messages", async () => {
    const target = endpoint();
    const inbox = await own(target);
    const seen: Handoff[] = [];
    inbox.subscribe((msg) => seen.push(msg));
    await raw(target, "not json");
    await raw(target, JSON.stringify({ magnet: "x".repeat(70 * 1024) }));
    const got = new Promise<void>((resolve) => inbox.subscribe(() => resolve()));
    await claim({ magnet: MAGNET }, target);
    await got;
    expect(seen).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "replaces a socket file left behind by a crashed run",
    async () => {
      const target = endpoint();
      writeFileSync(target, "");
      const inbox = await own(target);
      const got = next(inbox);
      expect(await claim({ magnet: MAGNET }, target)).toBe("sent");
      expect(await got).toEqual({ magnet: MAGNET });
    },
  );
});
