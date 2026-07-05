import { describe, it, expect } from "vitest";
import { parseRows, inferContent, computeProofOfWork, resolveMirrorHTML } from "./dontorrent";

describe("parseRows", () => {
  it("extracts movie search results", () => {
    const html = `
      <p><span><a href='/pelicula/965/Batman-Robin' class="text-decoration-none"><span class="text-secondary" >Batman</span> & Robin.</a> <span>(DVDRip)</a></span><span class="badge badge-primary float-right">Película</span></p>
      <p><span><a href='/serie/123/Otra-Cosa' class="text-decoration-none">Otra Serie</a> <span>(HDTV)</a></span><span class="badge badge-primary float-right">Serie</span></p>
    `;
    const rows = parseRows(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      url: "/pelicula/965/Batman-Robin",
      name: "Batman & Robin.",
      category: "Película"
    });
    expect(rows[1]).toEqual({
      url: "/serie/123/Otra-Cosa",
      name: "Otra Serie",
      category: "Serie"
    });
  });
});

describe("inferContent", () => {
  it("infers content id and table correctly", () => {
    expect(inferContent("/pelicula/965/Batman-Robin")).toEqual({ contentId: 965, tabla: "peliculas" });
    expect(inferContent("/serie/1234/Mi-Serie")).toEqual({ contentId: 1234, tabla: "series" });
    expect(inferContent("/documental/55/Docu")).toEqual({ contentId: 55, tabla: "documentales" });
    expect(inferContent("/other/99/Unknown")).toBeNull();
  });
});

describe("computeProofOfWork", () => {
  it("computes a valid nonce for a given challenge", () => {
    const challenge = "test_challenge_123";
    const nonce = computeProofOfWork(challenge, 2);
    expect(typeof nonce).toBe("number");
    
    // Validate manually
    const { createHash } = require("node:crypto");
    const hash = createHash("sha256").update(challenge + nonce).digest("hex");
    expect(hash.startsWith("00")).toBe(true);
  });
});

describe("resolveMirrorHTML", () => {
  it("extracts proxy from markdown-style link", () => {
    const html = `
      - [03d1-don.mirror.pm](https://03d1-don.mirror.pm) Proxy Generado
      [Ingresar al Proxy Generado](https://03d1-don.mirror.pm)
    `;
    expect(resolveMirrorHTML(html)).toBe("https://03d1-don.mirror.pm");
  });
  
  it("extracts proxy from html-style link", () => {
    const html = `<a href="https://ejemplo.mirror.pm" target="_blank">Proxy Generado</a>`;
    expect(resolveMirrorHTML(html)).toBe("https://ejemplo.mirror.pm");
  });
});
