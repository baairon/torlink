import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { arr2hex } from "uint8-util";

// Jul-2026 incident: uint8-util 2.3.x (released Jul-20) changed arr2hex to
// read data.buffer, which throws on the hex STRING webtorrent 2.8.5 passes it
// from Torrent._onTorrentId. That surfaces as an unhandled promise rejection
// inside webtorrent's fire-and-forget async startup, unreachable by any
// caller's try/catch, and it killed every fresh install on every magnet add
// and every boot with saved downloads (the repo lockfile kept dev and CI on
// the tolerant 2.2.6, which is why nothing here ever saw it). The exact pin,
// as a direct dependency AND an override, keeps fresh installs deduped onto
// the known-good version. Lift it deliberately, with this test, only once the
// upstream call site or arr2hex handles strings again.
const KNOWN_GOOD = "2.2.6";

function readJson(rel: string): Record<string, any> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
}

describe("uint8-util quarantine pin", () => {
  it("package.json pins the exact version as a dependency and an override", () => {
    const pkg = readJson("../package.json");
    expect(pkg.dependencies["uint8-util"]).toBe(KNOWN_GOOD);
    expect(pkg.overrides["uint8-util"]).toBe(KNOWN_GOOD);
  });

  it("the lockfile resolved the pinned version", () => {
    const lock = readJson("../package-lock.json");
    expect(lock.packages["node_modules/uint8-util"].version).toBe(KNOWN_GOOD);
  });

  it("the resolved arr2hex tolerates webtorrent's string infoHash call", () => {
    const asAny = arr2hex as unknown as (data: unknown) => string;
    expect(() => asAny("fd568f2ceba6b2603e761e4b13e5308c8b0f8ae4")).not.toThrow();
  });
});
