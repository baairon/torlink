import { describe, expect, it } from "vitest";
import { pushRecentDir } from "./config";

describe("pushRecentDir", () => {
  it("prepends a new directory", () => {
    expect(pushRecentDir(["/a", "/b"], "/c")).toEqual(["/c", "/a", "/b"]);
  });

  it("dedupes an earlier duplicate to the front", () => {
    expect(pushRecentDir(["/a", "/b", "/c"], "/b")).toEqual(["/b", "/a", "/c"]);
  });

  it("caps the list at max entries", () => {
    const list = ["/1", "/2", "/3", "/4"];
    expect(pushRecentDir(list, "/5", 3)).toEqual(["/5", "/1", "/2"]);
  });

  it("returns the list unchanged for an empty dir", () => {
    const list = ["/a", "/b"];
    expect(pushRecentDir(list, "")).toBe(list);
  });

  it("never mutates the input list", () => {
    const list = ["/a", "/b"];
    const result = pushRecentDir(list, "/c");
    expect(list).toEqual(["/a", "/b"]);
    expect(result).not.toBe(list);
  });
});
