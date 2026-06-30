import { describe, it, expect } from "vitest";
import { parseUploadDate } from "./x1337";

const detail = (span: string) =>
  `<ul class="list"><li><strong>Date uploaded</strong><span>${span}</span> </li></ul>`;

describe("parseUploadDate", () => {
  it("parses the 'Mon. Dayth \\'YY' format to a UTC unix timestamp", () => {
    const ts = parseUploadDate(detail("Jun. 26th  '26"));
    expect(ts).toBe(Math.floor(Date.UTC(2026, 5, 26) / 1000));
  });

  it("handles single-digit days and other ordinals", () => {
    expect(parseUploadDate(detail("Jan. 1st '24"))).toBe(Math.floor(Date.UTC(2024, 0, 1) / 1000));
    expect(parseUploadDate(detail("Mar. 3rd '25"))).toBe(Math.floor(Date.UTC(2025, 2, 3) / 1000));
    expect(parseUploadDate(detail("Dec. 22nd '23"))).toBe(Math.floor(Date.UTC(2023, 11, 22) / 1000));
  });

  it("returns undefined when the field is missing or unparseable", () => {
    expect(parseUploadDate("<div>no date here</div>")).toBeUndefined();
    expect(parseUploadDate(detail("sometime"))).toBeUndefined();
  });
});
