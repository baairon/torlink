import { describe, expect, it } from "vitest";
import { pushRecentDir } from "./config";

describe("pushRecentDir", () => {
  it("prepends a new directory", () => {
    expect(pushRecentDir(["/a", "/b"], "/c")).toEqual(["/c", "/a", "/b"]);
  });

  it("moves an existing duplicate to the front instead of adding it twice", () => {
    expect(pushRecentDir(["/a", "/b", "/c"], "/b")).toEqual(["/b", "/a", "/c"]);
  });

  it("caps the result at max entries", () => {
    expect(pushRecentDir(["/a", "/b", "/c"], "/d", 3)).toEqual(["/d", "/a", "/b"]);
  });

  it("is a no-op for an empty dir", () => {
    const list = ["/a", "/b"];
    expect(pushRecentDir(list, "")).toBe(list);
  });

  it("does not mutate the input array", () => {
    const list = ["/a", "/b"];
    pushRecentDir(list, "/c");
    expect(list).toEqual(["/a", "/b"]);
  });
});
