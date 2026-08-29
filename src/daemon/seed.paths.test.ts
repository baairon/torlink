import { describe, it, expect } from "vitest";
import path from "node:path";

import { seedRootFor } from "./seed";

describe("seedRootFor", () => {
  /*
   * The one calculation that decides whether seeding works or silently
   * re-downloads. A torrent names its own top-level entry, so the client's
   * download directory has to be the content's PARENT: pointed at the content
   * itself it looks for album/album, finds nothing, and fetches a second copy
   * next to the one already on disk.
   */
  it("is the content's parent, never the content", () => {
    expect(seedRootFor("/srv/media/album")).toBe("/srv/media");
    expect(seedRootFor("/srv/media/film.mkv")).toBe("/srv/media");
  });

  it("resolves a relative path before taking the parent", () => {
    expect(path.isAbsolute(seedRootFor("./album"))).toBe(true);
    expect(seedRootFor("./album")).toBe(process.cwd());
  });

  // A trailing slash is what tab-completion gives you for a directory, and it
  // would otherwise make dirname return the directory itself.
  it("is not fooled by a trailing slash", () => {
    expect(seedRootFor("/srv/media/album/")).toBe("/srv/media");
  });
});
