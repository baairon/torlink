import { describe, it, expect } from "vitest";
import { tuiCommand, SESSION } from "./attach";

describe("tuiCommand", () => {
  it("sh-quotes the node binary and script so tmux runs the plain TUI", () => {
    expect(tuiCommand("/usr/bin/node", "/opt/torlink/dist/index.js")).toBe(
      "'/usr/bin/node' '/opt/torlink/dist/index.js'",
    );
  });
  it("escapes single quotes in paths", () => {
    expect(tuiCommand("/us'r/node", "/a b/x.js")).toBe("'/us'\\''r/node' '/a b/x.js'");
  });
  it("names one stable session", () => {
    expect(SESSION).toBe("torlink");
  });
});
