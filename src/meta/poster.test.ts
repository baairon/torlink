import { describe, expect, it, vi, beforeEach } from "vitest";
import { POSTER_HOSTS, fetchPosterBytes, isAllowedPosterUrl, isJpeg } from "./poster";
import { fetchResilient } from "../util/net";

vi.mock("../util/net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../util/net")>();
  return { ...actual, fetchResilient: vi.fn() };
});

const mockFetch = vi.mocked(fetchResilient);

const AMAZON = "https://m.media-amazon.com/images/M/MV5BN2Nm._V1_SX120.jpg";
const METAHUB = "https://images.metahub.space/poster/small/tt0133093/img?format=jpeg";

const jpegBody = (extra = 0): Uint8Array =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array<number>(extra).fill(0)]);

/** WebP: the body metahub sometimes returns regardless of `?format=jpeg`. */
const WEBP_BODY = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

function respond(body: Uint8Array, init: { status?: number; length?: string } = {}): void {
  const headers = new Headers();
  headers.set("content-length", init.length ?? String(body.byteLength));
  mockFetch.mockResolvedValue(new Response(body, { status: init.status ?? 200, headers }));
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("isAllowedPosterUrl", () => {
  it("accepts https on each allowlisted host", () => {
    for (const host of POSTER_HOSTS) {
      expect(isAllowedPosterUrl(`https://${host}/poster.jpg`)).toBe(true);
    }
  });

  it("rejects any scheme but https", () => {
    expect(isAllowedPosterUrl("http://images.metahub.space/poster.jpg")).toBe(false);
    expect(isAllowedPosterUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedPosterUrl("data:image/jpeg;base64,/9j/")).toBe(false);
  });

  it("rejects hosts that merely look allowlisted", () => {
    // The suffix and prefix tricks a substring match would wave through.
    expect(isAllowedPosterUrl("https://images.metahub.space.evil.test/p.jpg")).toBe(false);
    expect(isAllowedPosterUrl("https://evil.test/images.metahub.space/p.jpg")).toBe(false);
    expect(isAllowedPosterUrl("https://notimages.metahub.space/p.jpg")).toBe(false);
  });

  it("rejects a port or credentials smuggled into the authority", () => {
    expect(isAllowedPosterUrl("https://images.metahub.space:8443/p.jpg")).toBe(false);
    expect(isAllowedPosterUrl("https://user:pw@images.metahub.space/p.jpg")).toBe(false);
  });

  it("rejects anything that is not a URL at all", () => {
    expect(isAllowedPosterUrl("")).toBe(false);
    expect(isAllowedPosterUrl("images.metahub.space/p.jpg")).toBe(false);
    expect(isAllowedPosterUrl("not a url")).toBe(false);
  });
});

describe("isJpeg", () => {
  it("accepts a start-of-image marker and rejects everything else", () => {
    expect(isJpeg(jpegBody())).toBe(true);
    expect(isJpeg(WEBP_BODY)).toBe(false);
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false);
    expect(isJpeg(new Uint8Array(0))).toBe(false);
  });
});

describe("fetchPosterBytes", () => {
  it("returns the bytes for an allowlisted JPEG", async () => {
    respond(jpegBody(120));
    await expect(fetchPosterBytes(AMAZON)).resolves.toEqual(jpegBody(120));
  });

  it("retries once — enough for a transient blip, not enough to outlive the cursor", async () => {
    respond(jpegBody());
    await fetchPosterBytes(METAHUB);
    expect(mockFetch).toHaveBeenCalledWith(METAHUB, expect.objectContaining({ retries: 1 }));
  });

  it("never leaves the allowlist, and does not even open a connection to try", async () => {
    await expect(fetchPosterBytes("https://evil.test/p.jpg")).resolves.toBeNull();
    await expect(fetchPosterBytes("http://m.media-amazon.com/p.jpg")).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null for a non-OK response", async () => {
    respond(jpegBody(), { status: 404 });
    await expect(fetchPosterBytes(METAHUB)).resolves.toBeNull();
  });

  it("refuses an oversized body from its declared length, before reading it", async () => {
    respond(jpegBody(), { length: String(2 * 1024 * 1024) });
    await expect(fetchPosterBytes(METAHUB)).resolves.toBeNull();
  });

  it("refuses an oversized body that declared nothing", async () => {
    // The chunked case: content-length is absent, so only the post-read cap can catch it.
    const huge = jpegBody(2 * 1024 * 1024);
    mockFetch.mockResolvedValue(new Response(huge, { status: 200 }));
    await expect(fetchPosterBytes(METAHUB)).resolves.toBeNull();
  });

  it("rejects a WebP body rather than handing the decoder garbage", async () => {
    respond(WEBP_BODY);
    await expect(fetchPosterBytes(METAHUB)).resolves.toBeNull();
  });

  it("returns null when the request throws", async () => {
    mockFetch.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(fetchPosterBytes(METAHUB)).resolves.toBeNull();
  });
});
