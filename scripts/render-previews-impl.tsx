import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { StoreContext, type Store } from "../src/ui/store";
import { COLOR, ICON, SOURCE_STYLE, lerpHex } from "../src/ui/theme";
import { Logo } from "../src/ui/components/Logo";
import { Rule } from "../src/ui/components/Rule";
import { Footer } from "../src/ui/components/Footer";
import { Sidebar, RAIL_WIDTH } from "../src/ui/components/Sidebar";
import { SearchBar } from "../src/ui/components/SearchBar";
import { Panel } from "../src/ui/components/Panel";
import { Poster } from "../src/ui/components/Poster";
import { Downloads } from "../src/ui/components/Downloads";
import { footerHints } from "../src/ui/keymap";
import { PANE_GAP, posterBudget, previewLayout } from "../src/ui/previewLayout";
import { wordWrapLines } from "../src/ui/textWidth";
import { sourcesByGroup } from "../src/sources/registry";
import { cleanText, formatBytes, formatRelative } from "../src/util/format";
import { ansiToSvg, type AnsiToSvgOptions } from "./ansi-to-svg";
import type { Config } from "../src/config/config";
import type { DownloadQueue } from "../src/download/queue";
import type { QueueItem, SeedItem } from "../src/download/types";
import type { HistoryItem } from "../src/download/history";
import type { Meta } from "../src/meta/types";
import type { PosterCells } from "../src/meta/image";
import type { TorrentResult } from "../src/sources/types";

const COLS = 80;
const CONTENT_WIDTH = Math.max(24, COLS - RAIL_WIDTH - 3);
const RULE_WIDTH = Math.max(10, COLS - 2);
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "preview");
mkdirSync(OUT_DIR, { recursive: true });

const NOW = Math.floor(Date.now() / 1000);
const NOW_MS = Date.now();

const RESULTS: TorrentResult[] = [
  { infoHash: "b2", name: "Oppenheimer (2023) [1080p WEB]", source: "yts", sizeBytes: 2.1e9, seeders: 1240, leechers: 88, magnet: "", added: NOW - 7200 },
  { infoHash: "g7", name: "Dune: Part Two (2024) [2160p BluRay]", source: "yts", sizeBytes: 8.4e9, seeders: 910, leechers: 41, magnet: "", added: NOW - 90000 },
  { infoHash: "c3", name: "Breaking Bad S05E14 1080p WEB-DL", source: "eztv", sizeBytes: 1.6e9, seeders: 540, leechers: 31, magnet: "", added: NOW - 1800 },
  { infoHash: "e5", name: "[Erai-raws] Jujutsu Kaisen S2 - 23 [1080p]", source: "nyaa", sizeBytes: 1.3e9, seeders: 320, leechers: 12, magnet: "", added: NOW - 900 },
  { infoHash: "d4", name: "Frieren - 28 [1080p]", source: "subsplease", sizeBytes: 1.4e9, seeders: 0, leechers: 0, magnet: "", added: NOW - 600 },
  { infoHash: "a1", name: "Elden Ring: Shadow of the Erdtree Edition", source: "fitgirl", sizeBytes: 0, seeders: 0, leechers: 0, magnet: "", added: NOW - 3600 },
];

const DOWNLOADS: QueueItem[] = [
  { id: "x1", name: "Dune: Part Two (2024) [2160p BluRay]", source: "yts", magnet: "", dir: "", status: "downloading", progress: 64, totalBytes: 8.4e9, downloadedBytes: 5.4e9, speed: 8.1e6, peers: 41, eta: 360, addedAt: NOW_MS },
];

const HISTORY: HistoryItem[] = [
  { id: "h1", name: "Elden Ring: Shadow of the Erdtree Edition", source: "fitgirl", sizeBytes: 54e9, magnet: "", dir: "", completedAt: NOW_MS - 3_600_000 },
  { id: "h2", name: "Breaking Bad S05E14 1080p WEB-DL", source: "eztv", sizeBytes: 1.6e9, magnet: "", dir: "", completedAt: NOW_MS - 90_000_000 },
];

function fakeQueue(
  items: QueueItem[],
  history: HistoryItem[],
  seeds: SeedItem[] = [],
): DownloadQueue {
  const active = items.filter((i) => i.status === "downloading").length;
  const seedingCount = seeds.filter((s) => s.status === "seeding").length;
  const seedMap = new Map(seeds.map((s) => [s.id, s]));
  const stub = {
    getItems: () => items,
    getHistory: () => history,
    getSeeds: () => seeds,
    getSeed: (id: string) => seedMap.get(id),
    activeCount: active,
    seedingCount,
    on: () => stub,
    off: () => stub,
  };
  return stub as unknown as DownloadQueue;
}

function makeStore(
  overrides: Partial<Store> = {},
  items: QueueItem[] = [],
  history: HistoryItem[] = [],
  seeds: SeedItem[] = [],
): Store {
  const noop = (): void => {};
  return {
    config: { downloadDir: "~/Downloads/torlink" } as Config,
    setConfig: noop,
    queue: fakeQueue(items, history, seeds),
    view: "browser",
    setView: noop,
    query: "",
    submitQuery: noop,
    section: "all",
    setSection: noop,
    region: "content",
    setRegion: noop,
    captureMode: "none",
    setCaptureMode: noop,
    downloadFocus: null,
    setDownloadFocus: noop,
    seedFocus: null,
    setSeedFocus: noop,
    resultFocus: null,
    setResultFocus: noop,
    previewOpen: false,
    setPreviewOpen: noop,
    startDownload: noop,
    requestDownloadTo: noop,
    copyMagnet: noop,
    openDownloadFolder: noop,
    exportTorrent: noop,
    fetchAndExportTorrent: noop,
    notice: null,
    setNotice: noop,
    quitAll: noop,
    listRows: 14,
    compact: false,
    contentWidth: CONTENT_WIDTH,
    cols: COLS,
    rows: 24,
    ...overrides,
  };
}

function save(
  name: string,
  store: Store,
  node: React.ReactNode,
  extra: Partial<AnsiToSvgOptions> = {},
): void {
  const { lastFrame, unmount } = render(
    <StoreContext.Provider value={store}>{node}</StoreContext.Provider>,
  );
  const frame = lastFrame() ?? "";
  unmount();
  if (!/\x1b\[/.test(frame)) {
    throw new Error(`${name}: frame has no ANSI colors (FORCE_COLOR didn't take)`);
  }
  writeFileSync(
    join(OUT_DIR, `${name}.svg`),
    ansiToSvg(frame, { cols: COLS, title: "torlink", ...extra }),
  );
  console.log(`preview/${name}.svg`);
}

const CATEGORIES = sourcesByGroup()
  .map((g) => g.group.toLowerCase())
  .join(`  ${ICON.dot}  `);

save(
  "splash",
  makeStore({ view: "splash", region: "content" }),
  <Box height={18} flexDirection="column" justifyContent="center" alignItems="center" width={COLS}>
    <Logo />
    <Box marginTop={2}>
      <Text color={COLOR.text}>A curated, terminal-native torrent downloader.</Text>
    </Box>
    <Box>
      <Text dimColor>{CATEGORIES}</Text>
    </Box>
    <Box marginTop={1} width={62}>
      <SearchBar width={62} value="" editing placeholder="Search or paste a magnet link…" onSubmit={() => {}} />
    </Box>
    <Box marginTop={1}>
      <Text>
        <Text color={COLOR.alt}>↵</Text>
        <Text dimColor> search</Text>
        <Text dimColor>{`  ${ICON.dot}  `}</Text>
        <Text dimColor>empty </Text>
        <Text color={COLOR.alt}>↵</Text>
        <Text dimColor> browse</Text>
        <Text dimColor>{`  ${ICON.dot}  `}</Text>
        <Text color={COLOR.alt}>^c</Text>
        <Text dimColor> quit</Text>
      </Text>
    </Box>
  </Box>,
);

const browseResults = RESULTS.slice(0, 5);
const showStats = browseResults.some((r) => r.sizeBytes > 0 || r.seeders > 0);
const numW = Math.max(2, String(browseResults.length).length);

save(
  "browse",
  makeStore({ section: "all", contentWidth: CONTENT_WIDTH, listRows: 14, cols: COLS, rows: 24 }),
  <Box flexDirection="column" width={COLS} paddingX={1}>
    <Box justifyContent="space-between">
      <Logo />
    </Box>
    <Rule width={RULE_WIDTH} />
    <Box height={14} marginTop={1}>
      <Sidebar />
      <Box flexGrow={1} flexDirection="column">
        <SearchBar width={CONTENT_WIDTH} value="" editing={false} placeholder="Search or paste a magnet link…" onSubmit={() => {}} />
        <Box marginTop={1}>
          <Panel title="latest" width={CONTENT_WIDTH} focused count={`(${browseResults.length})`} height={9}>
            <Box><Text dimColor>newest across all sources</Text></Box>
            <Box flexDirection="column" marginTop={1}>
              <Box>
                <Box width={2} flexShrink={0} />
                <Box width={numW} flexShrink={0} justifyContent="flex-end"><Text bold dimColor>#</Text></Box>
                <Box flexGrow={1} minWidth={0} marginLeft={1}><Text bold dimColor>Name</Text></Box>
                <Box width={10} flexShrink={0} marginLeft={1} justifyContent="flex-end"><Text bold dimColor>Size</Text></Box>
                <Box width={9} flexShrink={0} marginLeft={1} justifyContent="flex-end"><Text bold dimColor>Seed:Lch</Text></Box>
                <Box width={4} flexShrink={0} marginLeft={1} justifyContent="flex-end"><Text bold dimColor>Src</Text></Box>
              </Box>
              {browseResults.map((r, i) => {
                const here = i === 0;
                const ss = SOURCE_STYLE[r.source];
                return (
                  <Box key={r.infoHash}>
                    <Box width={2} flexShrink={0}>
                      <Text color={COLOR.accent}>{here ? ICON.pointer : ""}</Text>
                    </Box>
                    <Box width={numW} flexShrink={0} justifyContent="flex-end">
                      <Text dimColor>{i + 1}</Text>
                    </Box>
                    <Box flexGrow={1} minWidth={0} marginLeft={1}>
                      <Text wrap="truncate-end" color={here ? COLOR.accent : undefined} dimColor={!here} bold={here}>
                        {cleanText(r.name)}
                      </Text>
                    </Box>
                    {showStats ? (
                      <>
                        <Box width={10} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                          <Text dimColor>{r.sizeBytes > 0 ? formatBytes(r.sizeBytes) : "-"}</Text>
                        </Box>
                        <Box width={9} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                          <Text color={r.seeders > 0 ? COLOR.good : undefined} dimColor={r.seeders === 0}>
                            {r.seeders || r.leechers ? `${r.seeders}:${r.leechers}` : "-"}
                          </Text>
                        </Box>
                      </>
                    ) : (
                      <Box width={9} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                        <Text dimColor>{formatRelative(r.added) || "-"}</Text>
                      </Box>
                    )}
                    <Box width={4} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                      <Text color={ss.color} dimColor={!here}>
                        {ss.tag}
                      </Text>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Panel>
        </Box>
      </Box>
    </Box>
    <Footer hints={footerHints("content", "all")} />
  </Box>,
);

save(
  "downloads",
  makeStore({ section: "downloads", contentWidth: CONTENT_WIDTH, listRows: 10, cols: COLS, rows: 24 }, DOWNLOADS, HISTORY),
  <Box flexDirection="column" width={COLS} paddingX={1}>
    <Box justifyContent="space-between">
      <Logo />
    </Box>
    <Rule width={RULE_WIDTH} />
    <Box height={10} marginTop={1}>
      <Sidebar />
      <Box flexGrow={1} flexDirection="column">
        <Downloads />
      </Box>
    </Box>
    <Footer hints={footerHints("content", "downloads")} />
  </Box>,
  { shimmer: true },
);

// previewLayout only gives the results list a pane once contentWidth reaches 73, and only draws
// poster art in it from 86 — the 80-column COLS every other scenario uses never gets there. This
// one runs wider, on purpose, so the info pane has something to show.
const META_COLS = 120;
const META_CONTENT_WIDTH = Math.max(24, META_COLS - RAIL_WIDTH - 3);
const META_RULE_WIDTH = Math.max(10, META_COLS - 2);
const META_PANEL_H = 18;

const metaPane = previewLayout(META_CONTENT_WIDTH);
if (metaPane === null) {
  throw new Error(`preview: "info" scenario's ${META_COLS} columns are too narrow for the pane`);
}

const META: Meta = {
  imdbId: "tt15398776",
  kind: "movie",
  title: "Oppenheimer",
  year: "2023",
  rating: "8.3",
  runtime: "180 min",
  genres: ["Biography", "Drama", "History"],
  director: ["Christopher Nolan"],
  cast: ["Cillian Murphy", "Emily Blunt", "Matt Damon"],
};

// Panel's frame (border 2 + paddingX 2), same arithmetic MetaPane does for its own inner width.
const metaInner = Math.max(1, metaPane.pane - 4);
const metaInnerRows = Math.max(0, META_PANEL_H - 1);
const metaBudget = posterBudget(metaPane.pane, metaInnerRows, false);
if (metaBudget === null) {
  throw new Error(`preview: "info" scenario's panel is too short to budget poster rows`);
}

/**
 * A gradient standing in for a decoded poster — the previews never touch the network, so there is
 * no JPEG to decode. Built from the same lerpHex the shimmer sheen uses, staying inside the app's
 * own palette rather than inventing new colour.
 */
function posterMock(cols: number, rows: number): PosterCells {
  const top = "#1c1430";
  const bottom = COLOR.bright;
  const lines = Array.from({ length: rows }, (_, row) => {
    const t = rows <= 1 ? 0 : row / (rows - 1);
    const fg = lerpHex(top, bottom, t);
    const bg = lerpHex(top, bottom, Math.min(1, t + 1 / (rows * 2)));
    return [{ fg, bg, n: cols }];
  });
  return { cols, rows, lines };
}

const metaCastLines = wordWrapLines(`Cast ${META.cast.join(", ")}`, metaInner);

save(
  "info",
  makeStore({ section: "all", contentWidth: META_CONTENT_WIDTH, listRows: 14, cols: META_COLS, rows: 24 }),
  <Box flexDirection="column" width={META_COLS} paddingX={1}>
    <Box justifyContent="space-between">
      <Logo />
    </Box>
    <Rule width={META_RULE_WIDTH} />
    {/* +5: SearchBar's own Panel (a label row + a 2-row box) plus the 1-row gap above this
        Panel's own label row — everything this column holds above the results Panel, which a
        fixed outer height has to leave room for. Too little and Yoga shrinks the Panel instead
        of just cropping blank space, and a shrunk fixed-height Panel drops its own overflowing
        content rather than showing a clean edge. */}
    <Box height={META_PANEL_H + 5} marginTop={1}>
      <Sidebar />
      <Box flexGrow={1} flexDirection="column">
        <SearchBar width={META_CONTENT_WIDTH} value="" editing={false} placeholder="Search or paste a magnet link…" onSubmit={() => {}} />
        <Box marginTop={1}>
          <Panel title="latest" width={metaPane.list} focused count={`(${browseResults.length})`} height={META_PANEL_H}>
            <Box><Text dimColor>newest across all sources</Text></Box>
            <Box flexDirection="column" marginTop={1}>
              <Box>
                <Box width={2} flexShrink={0} />
                <Box width={numW} flexShrink={0} justifyContent="flex-end"><Text bold dimColor>#</Text></Box>
                <Box flexGrow={1} minWidth={0} marginLeft={1}><Text bold dimColor>Name</Text></Box>
                <Box width={10} flexShrink={0} marginLeft={1} justifyContent="flex-end"><Text bold dimColor>Size</Text></Box>
                <Box width={9} flexShrink={0} marginLeft={1} justifyContent="flex-end"><Text bold dimColor>Seed:Lch</Text></Box>
                <Box width={4} flexShrink={0} marginLeft={1} justifyContent="flex-end"><Text bold dimColor>Src</Text></Box>
              </Box>
              {browseResults.map((r, i) => {
                const here = i === 0;
                const ss = SOURCE_STYLE[r.source];
                return (
                  <Box key={r.infoHash}>
                    <Box width={2} flexShrink={0}>
                      <Text color={COLOR.accent}>{here ? ICON.pointer : ""}</Text>
                    </Box>
                    <Box width={numW} flexShrink={0} justifyContent="flex-end">
                      <Text dimColor>{i + 1}</Text>
                    </Box>
                    <Box flexGrow={1} minWidth={0} marginLeft={1}>
                      <Text wrap="truncate-end" color={here ? COLOR.accent : undefined} dimColor={!here} bold={here}>
                        {cleanText(r.name)}
                      </Text>
                    </Box>
                    {showStats ? (
                      <>
                        <Box width={10} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                          <Text dimColor>{r.sizeBytes > 0 ? formatBytes(r.sizeBytes) : "-"}</Text>
                        </Box>
                        <Box width={9} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                          <Text color={r.seeders > 0 ? COLOR.good : undefined} dimColor={r.seeders === 0}>
                            {r.seeders || r.leechers ? `${r.seeders}:${r.leechers}` : "-"}
                          </Text>
                        </Box>
                      </>
                    ) : (
                      <Box width={9} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                        <Text dimColor>{formatRelative(r.added) || "-"}</Text>
                      </Box>
                    )}
                    <Box width={4} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                      <Text color={ss.color} dimColor={!here}>
                        {ss.tag}
                      </Text>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Panel>
          <Box marginLeft={PANE_GAP}>
            <Panel title="info" width={metaPane.pane} height={META_PANEL_H}>
              <Box flexDirection="column">
                <Poster cells={posterMock(metaBudget.cols, metaBudget.rows)} />
                <Box height={1} flexShrink={0} />
                <Text wrap="wrap" bold color={COLOR.text}>{META.title}</Text>
                <Text wrap="wrap" dimColor>{[META.year, META.rating, META.runtime].join(` ${ICON.dot} `)}</Text>
                <Text wrap="wrap" dimColor>{META.genres.join(", ")}</Text>
                <Text wrap="wrap" dimColor>{`Dir ${META.director.join(", ")}`}</Text>
                {metaCastLines.map((line) => (
                  <Text key={line} wrap="wrap" dimColor>{line}</Text>
                ))}
              </Box>
            </Panel>
          </Box>
        </Box>
      </Box>
    </Box>
    <Footer hints={footerHints("content", "all", null, null, "list", true, true)} />
  </Box>,
  { cols: META_COLS },
);
