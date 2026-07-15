import { describe, it, expect } from "vitest";
import { interactionToCommand, interactionUserId } from "./slash";
import type { GatewayInteraction } from "./gateway";

const command = (name: string, options: { name: string; value: unknown }[] = []): GatewayInteraction => ({
  id: "1",
  token: "t",
  type: 2,
  data: { name, options },
});

describe("interactionToCommand", () => {
  it("maps a search with an 'all' category to no group", () => {
    const cmd = interactionToCommand(
      command("search", [
        { name: "category", value: "all" },
        { name: "query", value: "big buck bunny" },
      ]),
    );
    expect(cmd).toEqual({ kind: "search", query: "big buck bunny", group: undefined });
  });

  it("maps a category choice to its source group", () => {
    const cmd = interactionToCommand(
      command("search", [
        { name: "category", value: "Movies" },
        { name: "query", value: "matrix" },
      ]),
    );
    expect(cmd).toEqual({ kind: "search", query: "matrix", group: "Movies" });
  });

  it("maps add / status / cancel / help", () => {
    expect(interactionToCommand(command("add", [{ name: "item", value: "3" }]))).toEqual({ kind: "add", arg: "3" });
    expect(interactionToCommand(command("status"))).toEqual({ kind: "status" });
    expect(interactionToCommand(command("cancel", [{ name: "item", value: "2" }]))).toEqual({ kind: "cancel", arg: "2" });
    expect(interactionToCommand(command("help"))).toEqual({ kind: "help" });
  });

  it("ignores non-command interactions and unknown names", () => {
    expect(interactionToCommand({ id: "1", token: "t", type: 3 })).toBeNull();
    expect(interactionToCommand(command("frobnicate"))).toBeNull();
  });
});

describe("interactionUserId", () => {
  it("prefers the guild member, falls back to the DM user", () => {
    expect(interactionUserId({ id: "1", token: "t", type: 2, member: { user: { id: "u1" } } })).toBe("u1");
    expect(interactionUserId({ id: "1", token: "t", type: 2, user: { id: "u2" } })).toBe("u2");
    expect(interactionUserId({ id: "1", token: "t", type: 2 })).toBeUndefined();
  });
});
