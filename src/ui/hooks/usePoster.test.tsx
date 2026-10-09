import { Text } from "ink";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodePoster } from "../../meta/image";
import {
  decodeGraphicsPoster,
  placeholderLines,
  transmitChunks,
  writeChunks,
} from "../../meta/kittyGraphics";
import { fetchPosterBytes } from "../../meta/poster";
import { renderUI } from "../testHarness";
import { setGraphicsTier } from "../graphics";
import { usePoster } from "./usePoster";
import type { ReactElement } from "react";
import type { PosterCells } from "../../meta/image";

// Both halves of the pipeline are mocked so these tests are about the hook's own contract — what
// it asks for, when it asks again, and whose answer it is allowed to render. The fetch and the
// decode have their own tests, and no test in this repo may touch the network.
vi.mock("../../meta/poster", () => ({ fetchPosterBytes: vi.fn() }));
vi.mock("../../meta/image", () => ({ decodePoster: vi.fn() }));
// The kitty encoder is mocked for the same reason: kittyGraphics.test.ts owns what the escapes
// say, and this file owns which of them the hook decides to send.
vi.mock("../../meta/kittyGraphics", () => ({
  decodeGraphicsPoster: vi.fn(),
  placeholderLines: vi.fn(),
  transmitChunks: vi.fn(),
  writeChunks: vi.fn(),
  idColor: vi.fn(() => "#0a0b0c"),
  nextImageId: vi.fn(() => 0x0a0b0c),
}));

const mockFetch = vi.mocked(fetchPosterBytes);
const mockDecode = vi.mocked(decodePoster);
const mockGraphicsDecode = vi.mocked(decodeGraphicsPoster);
const mockLines = vi.mocked(placeholderLines);
const mockChunks = vi.mocked(transmitChunks);
const mockWrite = vi.mocked(writeChunks);

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

interface Budget {
  cols: number;
  rows: number;
}

const WIDE: Budget = { cols: 24, rows: 18 };
const NARROW: Budget = { cols: 18, rows: 13 };

function cells(cols: number, rows: number): PosterCells {
  return { cols, rows, lines: Array.from({ length: rows }, () => [{ fg: "#000", bg: "#000", n: cols }]) };
}

// The module-level cache outlives every test in this file, exactly as it outlives a row selection
// in the app. Each test therefore owns a distinct URL, so one test's cached grid can never be the
// reason another one passes.
let urlSeq = 0;
const nextUrl = (): string => `https://images.metahub.space/poster/small/tt${++urlSeq}/img?format=jpeg`;

// The probe exposes its budget setter so a test can resize the pane the way a terminal resize
// does, without needing a rerender handle the shared harness does not provide.
let resize: ((b: Budget) => void) | null = null;

function Probe({
  url,
  first,
  enabled = true,
}: {
  url?: string;
  first: Budget;
  enabled?: boolean;
}): ReactElement {
  const [b, setB] = useState<Budget>(first);
  useEffect(() => {
    resize = setB;
    return () => {
      resize = null;
    };
  }, []);
  const { loading, cells: got } = usePoster(url, b.cols, b.rows, enabled);
  // "IMAGE" for the shape the terminal draws itself, "ART" for half-blocks: which tier answered is
  // as much a part of this hook's contract as what size it answered at.
  const shape = got !== null && "imageId" in got ? "IMAGE" : "ART";
  return <Text>{loading ? "LOADING" : got === null ? "NONE" : `${shape} ${got.cols}x${got.rows}`}</Text>;
}

/** Let Ink flush a render and any pending microtask. */
function tick(ms = 0): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function deferred(): { promise: Promise<Uint8Array | null>; settle: (b: Uint8Array | null) => void } {
  let settle: (b: Uint8Array | null) => void = () => {};
  const promise = new Promise<Uint8Array | null>((res) => {
    settle = res;
  });
  return { promise, settle };
}

beforeEach(() => {
  resize = null;
  mockFetch.mockReset();
  mockDecode.mockReset();
  // Half-blocks unless a test says otherwise, which is what every terminal but three gets.
  setGraphicsTier(null);
  mockGraphicsDecode.mockReset();
  mockLines.mockReset();
  mockChunks.mockReset();
  mockWrite.mockReset();
  mockGraphicsDecode.mockReturnValue({
    cols: 24,
    rows: 18,
    pxW: 192,
    pxH: 288,
    rgb: new Uint8Array(3),
  });
  mockLines.mockReturnValue(["placeholders"]);
  mockChunks.mockReturnValue(["\u001b_Ga=T;AAA\u001b\\"]);
  mockFetch.mockResolvedValue(BYTES);
  // Answer with a grid that matches whatever budget it was asked for, so a frame reading
  // "ART 24x18" is proof of which budget produced it.
  mockDecode.mockImplementation((_bytes, cols, rows) => cells(cols, rows));
});

describe("usePoster", () => {
  it("re-fetches when the pane narrows, and never shows the wider grid again", async () => {
    // The cache key carries the cell budget because the same poster at a different pane size is a
    // different picture. Keyed on the URL alone, this resize would serve the 24x18 grid into an
    // 18-column pane — which is the one direction MetaPane's own guard does catch, by refusing to
    // draw it at all, so the pane would silently lose its art instead of resizing it.
    const url = nextUrl();
    const ui = renderUI(<Probe url={url} first={WIDE} />);
    try {
      await vi.waitFor(() => expect(ui.frame()).toContain("ART 24x18"));
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Held in flight so the frame between the resize and the new art is observable.
      const slow = deferred();
      mockFetch.mockReturnValueOnce(slow.promise);

      resize?.(NARROW);
      // Wait on the two positive facts that pin the intermediate state, then read the negative
      // off the same frame: the probe only ever renders one of LOADING/NONE/"TIER WxH", so a
      // frame that just satisfied "contains LOADING" cannot also contain "ART 24x18".
      await vi.waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(ui.frame()).toContain("LOADING");
      });
      expect(ui.frame()).not.toContain("ART 24x18");

      slow.settle(BYTES);
      await vi.waitFor(() => expect(ui.frame()).toContain("ART 18x13"));
    } finally {
      ui.unmount();
    }
  });

  it("re-fetches when the pane widens, rather than serving an undersized grid", async () => {
    // The direction nothing downstream can catch. MetaPane refuses a grid *larger* than its
    // budget; a grid that is too small fits, draws, and simply leaves a column of dead space
    // beside a poster that no longer matches the pane. Only the key prevents it.
    const url = nextUrl();
    const ui = renderUI(<Probe url={url} first={NARROW} />);
    try {
      await vi.waitFor(() => expect(ui.frame()).toContain("ART 18x13"));
      expect(mockFetch).toHaveBeenCalledTimes(1);

      resize?.(WIDE);
      await vi.waitFor(() => expect(ui.frame()).toContain("ART 24x18"));
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(ui.frame()).not.toContain("ART 18x13");
      expect(mockDecode).toHaveBeenLastCalledWith(BYTES, 24, 18);
    } finally {
      ui.unmount();
    }
  });

  it("serves a remount at the same budget from cache, with no second fetch or decode", async () => {
    const url = nextUrl();
    const first = renderUI(<Probe url={url} first={WIDE} />);
    await vi.waitFor(() => expect(first.frame()).toContain("ART 24x18"));
    first.unmount();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockDecode).toHaveBeenCalledTimes(1);

    const second = renderUI(<Probe url={url} first={WIDE} />);
    try {
      await vi.waitFor(() => expect(second.frame()).toContain("ART 24x18"));
      // The whole point of caching the decoded cells rather than the bytes: scrolling back onto a
      // row costs neither the request nor the synchronous decode.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockDecode).toHaveBeenCalledTimes(1);
      expect(second.frame()).not.toContain("LOADING");
    } finally {
      second.unmount();
    }
  });

  it("negative-caches a poster that could not be fetched", async () => {
    const url = nextUrl();
    // Held in flight, the way the pane-narrows test holds its resize: the mount frame and the
    // settled frame both read "NONE", so only a LOADING frame between them tells "the fetch has
    // not started" apart from "the fetch finished with nothing".
    const miss = deferred();
    mockFetch.mockReturnValue(miss.promise);

    const first = renderUI(<Probe url={url} first={WIDE} />);
    await vi.waitFor(() => expect(first.frame()).toContain("LOADING"));

    miss.settle(null);
    await vi.waitFor(() => expect(first.frame()).toContain("NONE"));
    // A null body never reaches the decoder — there is nothing to decode.
    expect(mockDecode).not.toHaveBeenCalled();
    first.unmount();

    // What a remount that missed the negative cache would get: a request that never answers. It
    // would sit on LOADING, so the frame below fails on a broken cache as directly as the count.
    mockFetch.mockReturnValue(deferred().promise);
    const second = renderUI(<Probe url={url} first={WIDE} />);
    try {
      // A cache hit is served synchronously inside the effect, so there is no intermediate state
      // to wait on here — a real sleep instead, the same precedent as the unmount test below,
      // giving a miss the chance to render the LOADING frame that would disprove the cache.
      await tick(5);
      // A row whose poster is a 404 or a WebP must not re-ask on every revisit, and must render
      // its final answer without flashing a spinner first.
      expect(second.frame()).toContain("NONE");
      expect(second.frame()).not.toContain("LOADING");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      second.unmount();
    }
  });

  it("caches a decoded null so a broken image is not re-decoded either", async () => {
    const url = nextUrl();
    mockDecode.mockReturnValue(null);
    // Held in flight for the reason the negative-cache test holds its own: a decoded null renders
    // the same "NONE" the mount frame already shows, so LOADING is the only proof of the fetch.
    const slow = deferred();
    mockFetch.mockReturnValue(slow.promise);

    const first = renderUI(<Probe url={url} first={WIDE} />);
    await vi.waitFor(() => expect(first.frame()).toContain("LOADING"));

    slow.settle(BYTES);
    await vi.waitFor(() => expect(first.frame()).toContain("NONE"));
    first.unmount();

    // Again: a remount that re-fetched would park on LOADING rather than answer.
    mockFetch.mockReturnValue(deferred().promise);
    const second = renderUI(<Probe url={url} first={WIDE} />);
    try {
      // Cache hit, so nothing asynchronous to wait on — a real sleep, as above.
      await tick(5);
      expect(second.frame()).toContain("NONE");
      expect(second.frame()).not.toContain("LOADING");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockDecode).toHaveBeenCalledTimes(1);
    } finally {
      second.unmount();
    }
  });

  it("asks for nothing while disabled, with no url, or with no room to draw", async () => {
    // Every shape below takes the effect's early return, which sets IDLE synchronously — the same
    // state, and the same "NONE" frame, the probe already renders on mount. There is no
    // intermediate state here and no asynchronous fact to wait on, so a waitFor could only ever
    // pass on its first attempt. A real sleep instead, the same precedent as the unmount test
    // below: it gives a hook that wrongly asked the chance to answer, and the default mock answers
    // with art, which would replace every "NONE" below as well as tripping the counts at the end.
    const off = renderUI(<Probe url={nextUrl()} first={WIDE} enabled={false} />);
    await tick(5);
    expect(off.frame()).toContain("NONE");
    off.unmount();

    const noUrl = renderUI(<Probe first={WIDE} />);
    await tick(5);
    expect(noUrl.frame()).toContain("NONE");
    noUrl.unmount();

    // What posterBudget returning null looks like by the time it reaches the hook: a zero budget,
    // which must be treated as "no art" and not as a request for a 0x0 image.
    for (const budget of [
      { cols: 0, rows: 18 },
      { cols: 24, rows: 0 },
      { cols: 0, rows: 0 },
    ]) {
      const none = renderUI(<Probe url={nextUrl()} first={budget} />);
      await tick(5);
      expect(none.frame()).toContain("NONE");
      none.unmount();
    }

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDecode).not.toHaveBeenCalled();
  });

  it("drops a response for an unmounted row before paying for the decode", async () => {
    // The decode is synchronous and blocks the event loop, so a late response has to be discarded
    // *before* it, not after. Nothing downstream would notice the wasted work — this is the only
    // place it can be asserted.
    const slow = deferred();
    mockFetch.mockReturnValue(slow.promise);

    const ui = renderUI(<Probe url={nextUrl()} first={WIDE} />);
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    ui.unmount();

    slow.settle(BYTES);
    // Purely negative with no positive fact to pin it — the point is that nothing happens, so a
    // waitFor here would pass on its first attempt and prove nothing. Same precedent as
    // MetaPane.test.tsx:374: a real sleep gives the (mocked, synchronous) decode a chance to run
    // if the unmounted row's late response were wrongly accepted.
    await tick(5);
    expect(mockDecode).not.toHaveBeenCalled();
  });

  it("transmits the picture before it paints anything addressing it", async () => {
    // Ordering is the entire synchronisation between the two halves of this tier: Node orders
    // writes on a stream, so an image written before the state update that draws the placeholders
    // is in the terminal's store by the time they reach the screen.
    setGraphicsTier("kitty");
    const ui = renderUI(<Probe url={nextUrl()} first={WIDE} />);
    try {
      await vi.waitFor(() => expect(ui.frame()).toContain("IMAGE 24x18"));
      expect(mockWrite).toHaveBeenCalledTimes(1);
      expect(mockWrite.mock.calls[0]?.[1]).toEqual(["\u001b_Ga=T;AAA\u001b\\"]);
      // The half-block decoder is never asked: the tier answered.
      expect(mockDecode).not.toHaveBeenCalled();
    } finally {
      ui.unmount();
    }
  });

  it("falls back to half-blocks whenever the graphics path refuses", async () => {
    // A decode that failed, a picture past the diacritic table: both land here, and both still
    // show the user a poster.
    setGraphicsTier("kitty");
    mockGraphicsDecode.mockReturnValue(null);
    const ui = renderUI(<Probe url={nextUrl()} first={WIDE} />);
    try {
      await vi.waitFor(() => expect(ui.frame()).toContain("ART 24x18"));
      expect(mockWrite).not.toHaveBeenCalled();
    } finally {
      ui.unmount();
    }
  });

  it("keys the cache by tier, so neither tier can be served the other's art", async () => {
    const url = nextUrl();
    const blocks = renderUI(<Probe url={url} first={WIDE} />);
    await vi.waitFor(() => expect(blocks.frame()).toContain("ART 24x18"));
    blocks.unmount();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    setGraphicsTier("kitty");
    const native = renderUI(<Probe url={url} first={WIDE} />);
    try {
      await vi.waitFor(() => expect(native.frame()).toContain("IMAGE 24x18"));
      // Same url, same budget, different terminal: a cache hit here would draw a mosaic where the
      // picture should be.
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      native.unmount();
    }
  });

  it("asks for a bigger rendition when the terminal draws real pixels", async () => {
    setGraphicsTier("kitty");
    const url = "https://m.media-amazon.com/images/M/MV5Bwiring._V1_SX120.jpg";
    const ui = renderUI(<Probe url={url} first={WIDE} />);
    try {
      await vi.waitFor(() =>
        expect(mockFetch.mock.calls[0]?.[0]).toBe(
          "https://m.media-amazon.com/images/M/MV5Bwiring._V1_SX480.jpg",
        ),
      );
    } finally {
      ui.unmount();
    }
  });

  it("aborts the in-flight request when the budget changes under it", async () => {
    mockFetch.mockReturnValue(deferred().promise);
    const ui = renderUI(<Probe url={nextUrl()} first={WIDE} />);
    try {
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      const signal = mockFetch.mock.calls[0]?.[1]?.signal;
      expect(signal?.aborted).toBe(false);

      resize?.(NARROW);
      await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    } finally {
      ui.unmount();
    }
  });
});
