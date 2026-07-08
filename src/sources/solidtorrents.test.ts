import { describe, it, expect } from "vitest";
import { mapSolidResponse, type SolidTorrentResponse } from "./solidtorrents";

import { buildMagnet } from "./magnet";

describe("solidtorrents mapper", () => {
  it("maps valid response to TorrentResult", () => {
    const mockData: SolidTorrentResponse = {
      success: true,
      query: "ubuntu",
      took: 1,
      pagination: {
        page: 1,
        perPage: 20,
        total: 100,
        totalPages: 5,
        hasNext: true,
        hasPrev: false,
      },
      results: [
        {
          id: "123",
          infohash: "A7838B75C42B612DA3B6CC99BEED4ECB2D04CFF2",
          title: "ubuntu-22.04.2-desktop-amd64.iso",
          size: 4927586304,
          category: 1,
          seeders: 177,
          leechers: 331,
          downloads: 0,
          verified: false,
          updatedAt: "2026-07-05T12:45:04.364Z",
        },
      ],
    };

    const res = mapSolidResponse(mockData, "solid-movies");
    expect(res).toHaveLength(1);
    expect(res[0]).toEqual({
      infoHash: "a7838b75c42b612da3b6cc99beed4ecb2d04cff2",
      name: "ubuntu-22.04.2-desktop-amd64.iso",
      sizeBytes: 4927586304,
      seeders: 177,
      leechers: 331,
      source: "solid-movies",
      magnet: buildMagnet("a7838b75c42b612da3b6cc99beed4ecb2d04cff2", "ubuntu-22.04.2-desktop-amd64.iso"),
      added: Date.parse("2026-07-05T12:45:04.364Z"),
    });
  });

  it("handles empty results", () => {
    const mockData: SolidTorrentResponse = {
      success: true,
      query: "empty",
      took: 1,
      pagination: { page: 1, perPage: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
      results: [],
    };
    const res = mapSolidResponse(mockData, "solid-tv");
    expect(res).toHaveLength(0);
  });
});
