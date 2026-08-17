import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMeta, searchCatalog } from "../../meta/cinemeta";
import { renderUI } from "../testHarness";
import { useResultMeta } from "./useResultMeta";
import type { ReactElement } from "react";
import type { Meta } from "../../meta/types";
import type { TorrentResult } from "../../sources/types";

// Only the provider is mocked here — unlike useResultMeta.test.tsx, which mocks the orchestrator
// to test the hook alone. The whole point of this file is the seam *between* them: two live hooks
// on one row, sharing one real in-flight request through meta/lookup's refcount.
vi.mock("../../meta/cinemeta", () => ({
  searchCatalog: vi.fn(),
  fetchMeta: vi.fn(),
}));

const mockSearch = vi.mocked(searchCatalog);
const mockFetch = vi.mocked(fetchMeta);

// An id-carrying row, so the lookup takes the fast path and fetchMeta is the only call to control.
const ROW: TorrentResult = {
  infoHash: "dual-mount-1",
  name: "Palewind (2020) [1080p]",
  imdbId: "tt7700001",
  source: "yts",
  sizeBytes: 2.1e9,
  seeders: 40,
  leechers: 6,
  magnet: "magnet:?xt=urn:btih:dualmount1",
};

const FOUND: Meta = {
  imdbId: "tt7700001",
  kind: "movie",
  title: "Palewind",
  genres: [],
  cast: [],
  director: [],
};

/** Let Ink flush a render and any timer shorter than `ms`. */
const tick = (ms = 0): Promise<void> => new Promise((res) => setTimeout(res, ms));

let closeDetail: (() => void) | null = null;

function Probe({ tag, debounceMs }: { tag: string; debounceMs: number }): ReactElement {
  const { loading, meta } = useResultMeta(ROW, true, debounceMs);
  return <Text>{`${tag}=${loading ? "LOADING" : (meta?.title ?? "NONE")}`}</Text>;
}

/**
 * The exact shape Results renders: the pane always mounted on the cursor row, the detail view
 * mounted over it on the same row and closing independently.
 */
function Pair(): ReactElement {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    closeDetail = () => setOpen(false);
    return () => {
      closeDetail = null;
    };
  }, []);
  return (
    <Box flexDirection="column">
      {/* Detail commits with no debounce; the pane waits, because the cursor sweeps past rows. */}
      {open ? <Probe tag="detail" debounceMs={0} /> : null}
      <Probe tag="pane" debounceMs={20} />
    </Box>
  );
}

beforeEach(() => {
  closeDetail = null;
  mockSearch.mockReset();
  mockFetch.mockReset();
  mockSearch.mockResolvedValue([]);
});

describe("detail view and info pane on one row", () => {
  it("leaves the pane resolving after the detail view closes over it", async () => {
    // Held open so the detail view is still waiting on it when the pane joins, and both are still
    // waiting when the detail view closes — the ordering that broke before Task 3's refcount.
    let settle: (m: Meta | null) => void = () => {};
    mockFetch.mockReturnValue(
      new Promise<Meta | null>((res) => {
        settle = res;
      }),
    );

    const ui = renderUI(<Pair />);
    try {
      await tick(60);
      expect(ui.frame()).toContain("pane=LOADING");
      // One request for both mounts: the pane joined the detail view's flight rather than opening
      // a second socket for the same title.
      expect(mockFetch).toHaveBeenCalledTimes(1);

      closeDetail?.();
      await tick(10);
      expect(ui.frame()).not.toContain("detail=");

      settle(FOUND);
      await tick(10);
      // The pane must land on the answer. Sticking on "No metadata" here is the regression this
      // exists to catch: the leaving caller's abort reaching the shared request would hand the
      // pane a null it has no way to notice or retry.
      expect(ui.frame()).toContain("pane=Palewind");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      ui.unmount();
    }
  });
});
