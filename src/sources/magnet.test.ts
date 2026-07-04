import { describe, it, expect } from "vitest";
import { parseMagnet, parseInput, isInfoHash, normalizeInfoHash, buildMagnet } from "./magnet";

describe("parseMagnet", () => {
  it("keeps a full 40-char hex info hash", () => {
    const hash = "abcdef0123456789abcdef0123456789abcdef01";
    const m = parseMagnet(`magnet:?xt=urn:btih:${hash}&dn=Cool+Movie`);
    expect(m?.infoHash).toBe(hash);
    expect(m?.infoHash.length).toBe(40);
    expect(m?.name).toBe("Cool Movie");
  });

  it("decodes a 32-char base32 hash to 40-char hex", () => {
    const m = parseMagnet("magnet:?xt=urn:btih:MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U&dn=X");
    expect(m?.infoHash.length).toBe(40);
    expect(m?.infoHash).toMatch(/^[a-f0-9]{40}$/);
  });

  it("falls back to the hash as the name when dn is absent", () => {
    const hash = "abcdef0123456789abcdef0123456789abcdef01";
    const m = parseMagnet(`magnet:?xt=urn:btih:${hash}`);
    expect(m?.name).toBe(hash);
  });

  it("returns null for non-magnets and malformed hashes", () => {
    expect(parseMagnet("not a magnet")).toBeNull();
    expect(parseMagnet("magnet:?xt=urn:btih:tooshort")).toBeNull();
    expect(parseMagnet("prefix magnet:?xt=urn:btih:" + "a".repeat(40))).toBeNull();
  });
});

describe("normalizeInfoHash", () => {
  it("lowercases 40-char hex", () => {
    expect(normalizeInfoHash("ABCDEF0123456789ABCDEF0123456789ABCDEF01")).toBe(
      "abcdef0123456789abcdef0123456789abcdef01",
    );
  });
  it("decodes 32-char base32 to 40-char hex", () => {
    expect(normalizeInfoHash("MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U")).toMatch(/^[a-f0-9]{40}$/);
  });
});

describe("buildMagnet", () => {
  it("builds a magnet with encoded name and trackers", () => {
    const out = buildMagnet("abc123", "My Movie 2024");
    expect(out).toContain("xt=urn:btih:abc123");
    expect(out).toContain("dn=My%20Movie%202024");
    expect(out).toContain("&tr=");
  });
});

describe("isInfoHash", () => {
  it("accepts a bare 40-char hex hash", () => {
    expect(isInfoHash("a".repeat(40))).toBe(true);
  });
  it("accepts a bare 32-char base32 hash", () => {
    expect(isInfoHash("MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U")).toBe(true);
  });
  it("rejects ordinary queries and malformed hashes", () => {
    expect(isInfoHash("the office 1080p")).toBe(false);
    expect(isInfoHash("g".repeat(40))).toBe(false); // 40 chars but not hex
    expect(isInfoHash("a".repeat(39))).toBe(false); // too short
    expect(isInfoHash("")).toBe(false);
  });
});

describe("parseInput", () => {
  it("parses a full magnet URI just like parseMagnet", () => {
    const hash = "abcdef0123456789abcdef0123456789abcdef01";
    const m = parseInput(`magnet:?xt=urn:btih:${hash}&dn=Cool+Movie`);
    expect(m?.infoHash).toBe(hash);
    expect(m?.name).toBe("Cool Movie");
  });
  it("wraps a bare 40-char hex hash into a magnet with trackers", () => {
    const hash = "abcdef0123456789abcdef0123456789abcdef01";
    const m = parseInput(hash);
    expect(m?.infoHash).toBe(hash);
    expect(m?.name).toBe(hash);
    expect(m?.magnet).toContain(`xt=urn:btih:${hash}`);
    expect(m?.magnet).toContain("&tr=");
  });
  it("decodes a bare 32-char base32 hash to 40-char hex", () => {
    const m = parseInput("MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U");
    expect(m?.infoHash).toMatch(/^[a-f0-9]{40}$/);
    expect(m?.magnet).toContain(`xt=urn:btih:${m?.infoHash}`);
  });
  it("trims whitespace around a bare hash", () => {
    const hash = "abcdef0123456789abcdef0123456789abcdef01";
    expect(parseInput(`  ${hash}  `)?.infoHash).toBe(hash);
  });
  it("returns null for ordinary queries and junk", () => {
    expect(parseInput("the office 1080p")).toBeNull();
    expect(parseInput("g".repeat(40))).toBeNull(); // 40 chars but not hex
    expect(parseInput("magnet:?xt=urn:btih:tooshort")).toBeNull();
    expect(parseInput("")).toBeNull();
  });
});
