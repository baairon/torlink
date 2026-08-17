import { Text } from "ink";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodePoster } from "../../meta/image";
import { fetchPosterBytes } from "../../meta/poster";
import { renderUI } from "../testHarness";
import { usePoster } from "./usePoster";
import type { ReactElement } from "react";
import type { PosterCells } from "../../meta/image";

// Both halves of the pipeline are mocked so these tests are about the hook's own contract — what
// it asks for, when it asks again, and whose answer it is allowed to render. The fetch and the
// decode have their own tests, and no test in this repo may touch the network.
vi.mock("../../meta/poster", () => ({ fetchPosterBytes: vi.fn() }));
vi.mock("../../meta/image", () => ({ decodePoster: vi.fn() }));

const mockFetch = vi.mocked(fetchPosterBytes);
const mockDecode = vi.mocked(decodePoster);

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
  return <Text>{loading ? "LOADING" : got === null ? "NONE" : `ART ${got.cols}x${got.rows}`}</Text>;
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
      await tick(5);
      expect(ui.frame()).toContain("ART 24x18");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Held in flight so the frame between the resize and the new art is observable.
      const slow = deferred();
      mockFetch.mockReturnValueOnce(slow.promise);

      resize?.(NARROW);
      await tick(5);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(ui.frame()).not.toContain("ART 24x18");
      expect(ui.frame()).toContain("LOADING");

      slow.settle(BYTES);
      await tick(5);
      expect(ui.frame()).toContain("ART 18x13");
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
      await tick(5);
      expect(ui.frame()).toContain("ART 18x13");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      resize?.(WIDE);
      await tick(5);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(ui.frame()).toContain("ART 24x18");
      expect(ui.frame()).not.toContain("ART 18x13");
      expect(mockDecode).toHaveBeenLastCalledWith(BYTES, 24, 18);
    } finally {
      ui.unmount();
    }
  });

  it("serves a remount at the same budget from cache, with no second fetch or decode", async () => {
    const url = nextUrl();
    const first = renderUI(<Probe url={url} first={WIDE} />);
    await tick(5);
    expect(first.frame()).toContain("ART 24x18");
    first.unmount();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockDecode).toHaveBeenCalledTimes(1);

    const second = renderUI(<Probe url={url} first={WIDE} />);
    try {
      await tick(5);
      // The whole point of caching the decoded cells rather than the bytes: scrolling back onto a
      // row costs neither the request nor the synchronous decode.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockDecode).toHaveBeenCalledTimes(1);
      expect(second.frame()).toContain("ART 24x18");
      expect(second.frame()).not.toContain("LOADING");
    } finally {
      second.unmount();
    }
  });

  it("negative-caches a poster that could not be fetched", async () => {
    const url = nextUrl();
    mockFetch.mockResolvedValue(null);

    const first = renderUI(<Probe url={url} first={WIDE} />);
    await tick(5);
    expect(first.frame()).toContain("NONE");
    // A null body never reaches the decoder — there is nothing to decode.
    expect(mockDecode).not.toHaveBeenCalled();
    first.unmount();

    const second = renderUI(<Probe url={url} first={WIDE} />);
    try {
      await tick(5);
      // A row whose poster is a 404 or a WebP must not re-ask on every revisit, and must render
      // its final answer without flashing a spinner first.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(second.frame()).toContain("NONE");
      expect(second.frame()).not.toContain("LOADING");
    } finally {
      second.unmount();
    }
  });

  it("caches a decoded null so a broken image is not re-decoded either", async () => {
    const url = nextUrl();
    mockDecode.mockReturnValue(null);

    const first = renderUI(<Probe url={url} first={WIDE} />);
    await tick(5);
    expect(first.frame()).toContain("NONE");
    first.unmount();

    const second = renderUI(<Probe url={url} first={WIDE} />);
    try {
      await tick(5);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockDecode).toHaveBeenCalledTimes(1);
      expect(second.frame()).toContain("NONE");
    } finally {
      second.unmount();
    }
  });

  it("asks for nothing while disabled, with no url, or with no room to draw", async () => {
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
    await tick(5);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    ui.unmount();

    slow.settle(BYTES);
    await tick(5);
    expect(mockDecode).not.toHaveBeenCalled();
  });

  it("aborts the in-flight request when the budget changes under it", async () => {
    mockFetch.mockReturnValue(deferred().promise);
    const ui = renderUI(<Probe url={nextUrl()} first={WIDE} />);
    try {
      await tick(5);
      const signal = mockFetch.mock.calls[0]?.[1]?.signal;
      expect(signal?.aborted).toBe(false);

      resize?.(NARROW);
      await tick(5);
      expect(signal?.aborted).toBe(true);
    } finally {
      ui.unmount();
    }
  });
});
