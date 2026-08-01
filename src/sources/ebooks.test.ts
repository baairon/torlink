import { describe, it, expect } from "vitest";
import { sourcesByGroup, SOURCES } from "./registry";
import { CATEGORIES } from "../ui/store";
import { sourceStyle } from "../ui/theme";

describe("E-Books & Audiobooks Categories Integration", () => {
  it("enforces category ordering: E-Books before Audiobooks in sourcesByGroup", () => {
    const groups = sourcesByGroup().map((g) => g.group);
    expect(groups).toEqual(["Games", "Movies", "TV", "Anime", "E-Books", "Audiobooks"]);
  });

  it("enforces sidebar CATEGORIES sequence: E-Books before Audiobooks", () => {
    const keys = CATEGORIES.map((c) => c.key);
    expect(keys).toEqual(["all", "games", "movies", "tv", "anime", "ebooks", "audiobooks"]);

    const ebookIdx = keys.indexOf("ebooks");
    const audioIdx = keys.indexOf("audiobooks");
    expect(ebookIdx).toBeGreaterThan(-1);
    expect(audioIdx).toBeGreaterThan(-1);
    expect(ebookIdx).toBeLessThan(audioIdx);
  });

  it("maps filtered Nyaa Literature, TPB, and 1337x sources to E-Books and Audiobooks groups", () => {
    const groups = sourcesByGroup();
    const ebookGroup = groups.find((g) => g.group === "E-Books");
    const audioGroup = groups.find((g) => g.group === "Audiobooks");

    const ebookSourceIds = ebookGroup?.sources.map((s) => s.id) ?? [];
    const audioSourceIds = audioGroup?.sources.map((s) => s.id) ?? [];

    expect(ebookSourceIds).toContain("tpb-ebooks");
    expect(ebookSourceIds).toContain("x1337-ebooks");
    expect(ebookSourceIds).toContain("nyaa-ebooks");

    expect(audioSourceIds).toContain("tpb-audiobooks");
    expect(audioSourceIds).toContain("x1337-audiobooks");
  });

  it("provides valid badge styles for all original indexer source IDs", () => {
    expect(sourceStyle("tpb-ebooks").tag).toBe("TPB");
    expect(sourceStyle("x1337-ebooks").tag).toBe("1337");
    expect(sourceStyle("nyaa-ebooks").tag).toBe("NYAA");
    expect(sourceStyle("tpb-audiobooks").tag).toBe("TPB");
    expect(sourceStyle("x1337-audiobooks").tag).toBe("1337");
    expect(sourceStyle("bittorrented").tag).toBe("BT");
  });
});
