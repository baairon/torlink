import { Text } from "ink";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookupMeta, peekMeta } from "../../meta/lookup";
import { renderUI } from "../testHarness";
import { useResultMeta } from "./useResultMeta";
import type { ReactElement } from "react";
import type { Meta } from "../../meta/types";
import type { TorrentResult } from "../../sources/types";

// The orchestrator is mocked so these tests are about the hook's own contract — which row it asks
// for, when it asks, and whose answer it is allowed to render.
vi.mock("../../meta/lookup", () => ({ peekMeta: vi.fn(), lookupMeta: vi.fn() }));

const mockPeek = vi.mocked(peekMeta);
const mockLookup = vi.mocked(lookupMeta);

function row(infoHash: string, name: string): TorrentResult {
  return {
    infoHash,
    name,
    sizeBytes: 2.1e9,
    seeders: 40,
    leechers: 6,
    source: "yts",
    magnet: `magnet:?xt=urn:btih:${infoHash}`,
  };
}

function meta(title: string): Meta {
  return { imdbId: "tt1234567", kind: "movie", title, genres: [], cast: [], director: [] };
}

const ALPHA = row("h-alpha", "Alpha (2019) [1080p]");
const BRAVO = row("h-bravo", "Bravo (2020) [1080p]");

// The probe exposes its row setter so a test can change the selection the way the results list
// does, without needing a rerender handle the shared harness does not provide.
let swap: ((r: TorrentResult | null) => void) | null = null;

function Probe({
  first,
  debounceMs,
  enabled = true,
}: {
  first: TorrentResult | null;
  debounceMs: number;
  enabled?: boolean;
}): ReactElement {
  const [r, setR] = useState<TorrentResult | null>(first);
  useEffect(() => {
    swap = setR;
    return () => {
      swap = null;
    };
  }, []);
  const { loading, meta: found } = useResultMeta(r, enabled, debounceMs);
  return <Text>{loading ? "LOADING" : (found?.title ?? "NONE")}</Text>;
}

/**
 * Let Ink flush a render and any timer shorter than `ms`.
 *
 * Only for the waits that are *purely negative* — "nothing happened", "it did not ask again" —
 * and for the debounces, which are wall-clock facts by construction. Anything positive waits on
 * the fact itself with `vi.waitFor`, because a fixed sleep is a guess about how long a loaded
 * machine takes to settle a promise, and a wrong guess is a test that fails for no reason.
 */
function tick(ms = 0): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function deferred(): { promise: Promise<Meta | null>; settle: (m: Meta | null) => void } {
  let settle: (m: Meta | null) => void = () => {};
  const promise = new Promise<Meta | null>((res) => {
    settle = res;
  });
  return { promise, settle };
}

beforeEach(() => {
  swap = null;
  mockPeek.mockReset();
  mockLookup.mockReset();
  mockPeek.mockReturnValue(undefined);
  mockLookup.mockResolvedValue(null);
});

describe("useResultMeta", () => {
  it("never renders one row's metadata against another row", async () => {
    // The `alive` flag is the only thing enforcing this. Cache keys make the cache correct; they
    // do nothing to stop a late resolution landing in the state a different row is rendering.
    const slow = deferred();
    mockLookup.mockReturnValueOnce(slow.promise).mockResolvedValue(meta("Bravo"));

    const ui = renderUI(<Probe first={ALPHA} debounceMs={0} />);
    try {
      // The lookup is fired from a timer inside the effect, so it cannot have happened by the
      // time render() returns — this waits on a fact the mount frame does not already show.
      await vi.waitFor(() => expect(mockLookup).toHaveBeenCalledTimes(1));
      expect(mockLookup.mock.calls[0]?.[0]).toBe(ALPHA);

      swap?.(BRAVO);
      // Alpha is still pending, so the frame reads LOADING until Bravo's own lookup settles.
      await vi.waitFor(() => expect(ui.frame()).toContain("Bravo"));

      // Alpha's request finally comes back, long after the user moved on.
      slow.settle(meta("Alpha"));
      // Purely negative, with no positive fact to pin it: the point is that the late resolution
      // changes nothing, so a waitFor would pass on its first attempt and prove nothing. A real
      // sleep instead — the same precedent as MetaPane's unfocused-keys test — giving the
      // resolution every chance to land in the state Bravo is rendering.
      await tick(5);
      expect(ui.frame()).toContain("Bravo");
      expect(ui.frame()).not.toContain("Alpha");
    } finally {
      ui.unmount();
    }
  });

  it("aborts the in-flight lookup when the row changes", async () => {
    mockLookup.mockReturnValue(deferred().promise);
    const ui = renderUI(<Probe first={ALPHA} debounceMs={0} />);
    try {
      await vi.waitFor(() => expect(mockLookup).toHaveBeenCalledTimes(1));
      const signal = mockLookup.mock.calls[0]?.[1]?.signal;
      expect(signal?.aborted).toBe(false);

      swap?.(BRAVO);
      // The abort comes from the effect cleanup, which React runs on the render the swap
      // schedules rather than synchronously inside it — so this still has something to wait for.
      await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    } finally {
      ui.unmount();
    }
  });

  it("renders a cached row with no timer and no request", async () => {
    mockPeek.mockReturnValue(meta("Charlie"));

    // A debounce long enough that anything reaching the network would still be waiting.
    const ui = renderUI(<Probe first={ALPHA} debounceMs={5000} />);
    try {
      // A cache hit is served synchronously inside the effect, so there is no intermediate state
      // to wait on and every assertion below is a negative. A real sleep instead: it gives a hook
      // that wrongly armed the timer or the request the chance to show it.
      await tick(5);
      expect(ui.frame()).toContain("Charlie");
      expect(ui.frame()).not.toContain("LOADING");
      expect(mockLookup).not.toHaveBeenCalled();
    } finally {
      ui.unmount();
    }
  });

  it("renders a cached miss as a final answer, not as loading", async () => {
    // peekMeta answers null for a row that can never be queried at all, so the spinner would
    // otherwise never end.
    mockPeek.mockReturnValue(null);
    const ui = renderUI(<Probe first={ALPHA} debounceMs={5000} />);
    try {
      // "NONE" is what the mount frame already shows, so waiting for it would resolve on the
      // first attempt and prove nothing. A real sleep, as in the cached-hit test above: a hook
      // that treated the cached null as unanswered would replace it with LOADING in that window.
      await tick(5);
      expect(ui.frame()).toContain("NONE");
      expect(mockLookup).not.toHaveBeenCalled();
    } finally {
      ui.unmount();
    }
  });

  it("issues no lookup when the row is left before the debounce elapses", async () => {
    const ui = renderUI(<Probe first={ALPHA} debounceMs={60} />);
    await tick(5);
    expect(mockLookup).not.toHaveBeenCalled();

    ui.unmount();
    // Both waits are negative, and both are wall-clock by construction: the second has to outlive
    // the 60 ms the cancelled timer would have fired at. A sleep can only ever overshoot on a
    // loaded machine, which is the harmless direction for "still not called".
    await tick(120);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("waits out the debounce before asking, then asks once", async () => {
    const ui = renderUI(<Probe first={ALPHA} debounceMs={40} />);
    try {
      // The one wait in this file that a loaded machine can overshoot into failing: 5 ms is a
      // fraction of the 40 ms debounce, but only the clock says so. There is nothing else to
      // wait on — "has not asked yet" is exactly a negative — and fake timers would take the
      // debounce out of the test entirely.
      await tick(5);
      expect(mockLookup).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(mockLookup).toHaveBeenCalledTimes(1));
    } finally {
      ui.unmount();
    }
  });

  it("keys on the infoHash, so a re-sorted list does not retrigger", async () => {
    const ui = renderUI(<Probe first={ALPHA} debounceMs={0} />);
    try {
      await vi.waitFor(() => expect(mockLookup).toHaveBeenCalledTimes(1));

      // What a streaming re-sort produces: an equal row with a fresh object identity.
      swap?.({ ...ALPHA });
      // Negative — "it did not ask again" — so a real sleep, long enough that a retrigger would
      // have run its zero-length debounce and bumped the count this line reads.
      await tick(5);
      expect(mockLookup).toHaveBeenCalledTimes(1);

      // And the counter is not simply stuck — a genuinely different row does retrigger.
      swap?.(BRAVO);
      await vi.waitFor(() => expect(mockLookup).toHaveBeenCalledTimes(2));
    } finally {
      ui.unmount();
    }
  });

  it("asks for nothing while disabled or with no row", async () => {
    // Both shapes take the effect's early return, which sets IDLE synchronously — the same state,
    // and the same "NONE" frame, the probe already renders on mount. Nothing here is asynchronous
    // and every assertion is a negative, so a waitFor could only pass on its first attempt. Real
    // sleeps instead: a hook that wrongly asked has a whole debounce-free window to prove it.
    const off = renderUI(<Probe first={ALPHA} debounceMs={0} enabled={false} />);
    await tick(5);
    expect(off.frame()).toContain("NONE");
    expect(mockPeek).not.toHaveBeenCalled();
    expect(mockLookup).not.toHaveBeenCalled();
    off.unmount();

    const empty = renderUI(<Probe first={null} debounceMs={0} />);
    await tick(5);
    expect(mockLookup).not.toHaveBeenCalled();
    empty.unmount();
  });
});
