/**
 * Proves torlink's seeding actually transfers bytes (not just a UI label), and
 * that pause and resume really stop/restart it.
 *
 * Offline-deterministic: the leechers run with dht/tracker/lsd OFF and are
 * wired straight to our seeder via addPeer("127.0.0.1:<port>"), so the ONLY
 * possible source of data is the TorrentEngine under test.
 *
 *   npx tsx scripts/verify-seeding.ts
 */
import WebTorrent from "webtorrent";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TorrentEngine } from "../src/download/engine";

const FILE_BYTES = 4 * 1024 * 1024; // 4 MB
const PULL_TIMEOUT = 20_000;
const PAUSE_WINDOW = 6_000;

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

function randomBytes(n: number): Buffer {
  // Deterministic-ish filler; content doesn't matter, only that it transfers.
  const buf = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) buf[i] = (i * 31 + 7) & 0xff;
  return buf;
}

// Spin a leecher wired directly to the seeder; resolve with bytes downloaded.
// `source` is the .torrent path (metadata) so the leecher knows the pieces and
// the only open question is whether our seeder actually serves them.
function leech(
  source: string,
  port: number,
  dir: string,
  timeout: number,
): Promise<{ done: boolean; downloaded: number }> {
  return new Promise((resolve) => {
    const client = new WebTorrent({ dht: false, tracker: false, lsd: false });
    const torrent = client.add(source, { path: dir, announce: [] });
    let settled = false;
    let rewire: ReturnType<typeof setInterval> | null = null;
    const timer = setTimeout(() => finish(false), timeout);
    const finish = (done: boolean): void => {
      if (settled) return;
      settled = true;
      const downloaded = client.torrents[0]?.downloaded ?? 0;
      clearTimeout(timer);
      if (rewire) clearInterval(rewire);
      client.destroy(() => resolve({ done, downloaded }));
    };
    // A magnet has no metadata yet, so the leecher must learn it FROM this peer;
    // addPeer is only legal after the infoHash event. webtorrent's server binds
    // IPv6 (::), so use the v6 loopback (v4 too for good measure). Re-wire on a
    // timer: with discovery off, a dropped connection won't be re-found, so we
    // keep nudging the peer back in until the transfer completes.
    const wire = (): void => {
      torrent.addPeer(`[::1]:${port}`);
      torrent.addPeer(`127.0.0.1:${port}`);
    };
    torrent.on("infoHash", () => {
      wire();
      rewire = setInterval(wire, 1000);
    });
    torrent.on("done", () => finish(true));
  });
}

// Wait until the engine reports the torrent fully verified (progress 1), so we
// only start leeching once there is something complete to pull.
async function waitSeederReady(
  engine: TorrentEngine,
  id: string,
  timeout: number,
): Promise<{ progress: number; peers: number }> {
  const start = Date.now();
  for (;;) {
    const s = engine.stats(id);
    if (s && s.progress >= 1) return { progress: s.progress, peers: s.peers };
    if (Date.now() - start > timeout) return { progress: s?.progress ?? 0, peers: s?.peers ?? 0 };
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function main(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "torlink-seedcheck-"));
  const seedDir = path.join(root, "seed");
  await fs.mkdir(seedDir, { recursive: true });
  const filePath = path.join(seedDir, "payload.bin");
  await fs.writeFile(filePath, randomBytes(FILE_BYTES));
  log(`payload: ${filePath} (${FILE_BYTES} bytes)`);

  // Mint the .torrent metadata for the on-disk file via a throwaway client, then
  // drop it. This is what torlink now captures at download time and seeds from.
  const minter = new WebTorrent({ dht: false, tracker: false, lsd: false });
  const { meta, infoHash } = await new Promise<{ meta: Uint8Array; infoHash: string }>(
    (resolve) => {
      minter.seed(filePath, { announce: [] }, (t) =>
        resolve({ meta: Uint8Array.from(t.torrentFile), infoHash: t.infoHash }),
      );
    },
  );
  await new Promise<void>((r) => minter.destroy(() => r()));
  const torrentPath = path.join(root, "meta.torrent");
  await fs.writeFile(torrentPath, meta);
  log(`metadata minted: ${infoHash}`);

  const engine = new TorrentEngine();
  let failures = 0;
  const check = (label: string, ok: boolean, detail: string): void => {
    log(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
    if (!ok) failures++;
  };

  // 1) SEED — engine verifies the on-disk file from metadata and uploads it.
  engine.add(infoHash, torrentPath, seedDir, {
    onError: (m) => log(`seed onError: ${m}`),
  });
  const ready1 = await waitSeederReady(engine, infoHash, 10_000);
  const port1 = engine.listenPort();
  log(`engine seeding: progress=${ready1.progress} port=${port1}`);
  const r1 = await leech(torrentPath, port1 ?? 0, path.join(root, "leech1"), PULL_TIMEOUT);
  const s1 = engine.stats(infoHash);
  check(
    "seed uploads to a peer",
    r1.done && r1.downloaded === FILE_BYTES,
    `downloaded=${r1.downloaded}/${FILE_BYTES} done=${r1.done} engineUploaded=${s1?.uploaded ?? 0} peers=${s1?.peers ?? 0}`,
  );

  // 2) PAUSE — engine.remove tears the torrent down; a fresh leecher gets nothing.
  engine.remove(infoHash);
  await new Promise((r) => setTimeout(r, 500));
  const r2 = await leech(torrentPath, port1 ?? 0, path.join(root, "leech2"), PAUSE_WINDOW);
  check(
    "pause stops seeding",
    !r2.done && r2.downloaded === 0,
    `downloaded=${r2.downloaded} done=${r2.done} (expected 0 / false)`,
  );

  // 3) RESUME — re-add and a fresh leecher completes again.
  engine.add(infoHash, torrentPath, seedDir, {
    onError: (m) => log(`resume onError: ${m}`),
  });
  const ready3 = await waitSeederReady(engine, infoHash, 10_000);
  const port3 = engine.listenPort();
  log(`engine re-seeding: progress=${ready3.progress} port=${port3}`);
  const r3 = await leech(torrentPath, port3 ?? 0, path.join(root, "leech3"), PULL_TIMEOUT);
  const s3 = engine.stats(infoHash);
  check(
    "resume re-seeds",
    r3.done && r3.downloaded === FILE_BYTES,
    `downloaded=${r3.downloaded}/${FILE_BYTES} done=${r3.done} engineUploaded=${s3?.uploaded ?? 0}`,
  );

  engine.destroy();
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});

  log("");
  log(
    failures === 0
      ? "RESULT: seeding is REAL ✓ (seed/pause/resume verified)"
      : `RESULT: ${failures} check(s) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  log(`harness error: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
