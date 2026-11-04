import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The Jul-2026 uint8-util 2.2.6 quarantine that used to live here guarded the
// arr2hex(string) call in webtorrent 2.8.5's Torrent._onTorrentId. webtorrent 3
// no longer has that call site, so the pin went with the upgrade (#205).

function readJson(rel: string): Record<string, any> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
}

// Aug-2026 install breakage: node-datachannel 0.33.0 removed its `install`
// script entirely (0.32.3 ran `prebuild-install -r napi || (npm install
// --ignore-scripts --production=false && npm run _prebuild)`) and moved the
// native binary into nine per-platform optionalDependencies. npm 12 blocks
// install scripts that are not explicitly approved, so on 0.32.3 a fresh
// install leaves node-datachannel without its binary and every import of it
// throws "Cannot find module '../../../build/Release/node_datachannel.node'" —
// the failure behind #166, #60, #81, #89, #135 and #20. Optional dependencies
// need no script at all. webrtc-polyfill still asks for "^0.32.3", and a caret
// on a 0.x version pins the minor, so only an override moves the tree onto the
// prebuilt line. The 0.33 loader still checks a local build/ directory before
// the platform package, which keeps scripts/ensure-webrtc.cjs working as the
// compile-from-source fallback where no prebuilt exists.
const PREBUILT_LINE = "^0.33.1";
const ANDROID_PUBLISHED = "0.33.0";

function atLeast(version: string, min: string): boolean {
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

describe("node-datachannel prebuilt binaries", () => {
  it("package.json overrides the transitive range onto the prebuilt line", () => {
    const pkg = readJson("../package.json");
    expect(pkg.overrides["node-datachannel"]).toBe(PREBUILT_LINE);
  });

  it("the lockfile resolved a version that ships prebuilt binaries", () => {
    const lock = readJson("../package-lock.json");
    const resolved = lock.packages["node_modules/node-datachannel"].version;
    expect(atLeast(resolved, "0.33.1")).toBe(true);
  });

  it("the installed copy carries no install script and declares platform packages", () => {
    const installed = readJson("../node_modules/node-datachannel/package.json");
    expect(installed.scripts?.install).toBeUndefined();
    expect(Object.keys(installed.optionalDependencies ?? {})).toEqual(
      expect.arrayContaining([
        "@node-datachannel/linux-x64-gnu",
        "@node-datachannel/darwin-arm64",
        "@node-datachannel/win32-x64-msvc",
      ]),
    );
  });

  it("the native binding loads without any build step", async () => {
    const ndc = await import("node-datachannel");
    expect(typeof ndc.PeerConnection).toBe("function");
  });

  // 0.33.1 lists @node-datachannel/android-arm64@0.33.1 among its
  // optionalDependencies and that version was never published -- 0.33.0 is the
  // only one on the registry. npm then leaves the package out of the lockfile,
  // and `npm ci` refuses the result outright: "Missing:
  // @node-datachannel/android-arm64@ from lock file". So the override names the
  // version that does exist. 0.33.1 only added a Windows ARM64 build, so the
  // Android binary is the same one either way. Drop this once upstream
  // publishes the missing package.
  it("pins the platform package upstream declares but never published", () => {
    const pkg = readJson("../package.json");
    expect(pkg.overrides["@node-datachannel/android-arm64"]).toBe(ANDROID_PUBLISHED);
    const lock = readJson("../package-lock.json");
    expect(lock.packages["node_modules/@node-datachannel/android-arm64"].version).toBe(
      ANDROID_PUBLISHED,
    );
  });

  it("the lockfile carries every platform package the module declares", () => {
    const declared = Object.keys(
      readJson("../node_modules/node-datachannel/package.json").optionalDependencies ?? {},
    );
    const lock = readJson("../package-lock.json");
    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      expect(lock.packages[`node_modules/${name}`], `${name} missing from the lockfile`)
        .toBeDefined();
    }
  });
});
