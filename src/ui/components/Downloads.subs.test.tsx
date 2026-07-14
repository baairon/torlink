import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Downloads } from "./Downloads";
import { StoreContext, type Store } from "../store";
import { DownloadQueue } from "../../download/queue";
import type { HistoryItem } from "../../download/history";

function historyItem(subsLang?: string): HistoryItem {
  return {
    id: "abc",
    name: "Inception.2010.1080p.BluRay.x264-YIFY",
    source: "yts",
    sizeBytes: 2_000_000_000,
    magnet: "magnet:?xt=urn:btih:abc",
    dir: "/tmp/dl",
    completedAt: 1_700_000_000_000,
    ...(subsLang ? { subsLang } : {}),
  };
}

// Only the fields Downloads reads; the cast mirrors render-previews-impl's
// partial-store precedent.
function storeWith(queue: DownloadQueue): Store {
  return {
    queue,
    region: "content",
    contentWidth: 100,
    listRows: 12,
    startDownload: () => {},
    openDownloadFolder: () => {},
    setDownloadFocus: () => {},
    exportTorrent: () => {},
  } as unknown as Store;
}

function renderRecent(item: HistoryItem): string {
  const queue = new DownloadQueue();
  queue.restoreHistory([item]);
  const { lastFrame, unmount } = render(
    <StoreContext.Provider value={storeWith(queue)}>
      <Downloads />
    </StoreContext.Provider>,
  );
  const frame = lastFrame() ?? "";
  unmount();
  return frame;
}

describe("Downloads recent-row subtitle tag", () => {
  it("renders subs · <lang> when the entry has one", () => {
    expect(renderRecent(historyItem("en"))).toContain("subs · en");
  });

  it("renders no tag when the entry has none", () => {
    expect(renderRecent(historyItem())).not.toContain("subs ·");
  });
});
