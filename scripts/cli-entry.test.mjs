import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const entry = fileURLToPath(new URL("./cli-entry.cjs", import.meta.url));

// cli-entry settles the WebRTC question and only then imports ./index.js,
// which exists in dist/ and not in scripts/. Run from here that import fails
// and the process exits, which leaves exactly the part under test on stderr.
function runEntry(env) {
  const res = spawnSync(process.execPath, [entry], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return res.stderr ?? "";
}

describe("TORLINK_NO_WEBRTC", () => {
  it("turns WebRTC off when it is set", () => {
    // The second branch is Node 22.0-22.14, where module.registerHooks does not
    // exist and the opt-out says so rather than pretending to work.
    expect(runEntry({ TORLINK_NO_WEBRTC: "1" })).toMatch(
      /WebRTC peers disabled by TORLINK_NO_WEBRTC|TORLINK_NO_WEBRTC needs Node 22\.15/,
    );
  });

  it("says nothing about the flag when it is unset", () => {
    expect(runEntry({ TORLINK_NO_WEBRTC: "" })).not.toMatch(/TORLINK_NO_WEBRTC/);
  });
});
