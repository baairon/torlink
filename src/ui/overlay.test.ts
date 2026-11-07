import { afterEach, describe, expect, it } from "vitest";
import type { DOMElement } from "ink";
import { installOverlay, setOverlayImage, sixelSupported } from "./overlay";

const BSU = "\x1b[?2026h";
const ESU = "\x1b[?2026l";

// A fake Ink tree: root (height 30) > panel at (5, 4) > box at (60, 3).
function tree(boxSize = { w: 26, h: 20 }): DOMElement {
  const node = (nodeName: string, left: number, top: number, w: number, h: number, parent?: DOMElement) =>
    ({
      nodeName,
      parentNode: parent,
      yogaNode: {
        getComputedLeft: () => left,
        getComputedTop: () => top,
        getComputedWidth: () => w,
        getComputedHeight: () => h,
      },
    }) as unknown as DOMElement;
  const root = node("ink-root", 0, 0, 120, 30);
  const panel = node("ink-box", 5, 4, 100, 24, root);
  return node("ink-box", 60, 3, boxSize.w, boxSize.h, panel);
}

function fakeStream(rows = 40) {
  const out: string[] = [];
  const stream = { rows, write: (s: string) => (out.push(s), true) } as unknown as NodeJS.WriteStream;
  return { stream, out };
}

let uninstall: (() => void) | null = null;
afterEach(() => {
  setOverlayImage(null);
  uninstall?.();
  uninstall = null;
});

describe("sixelSupported", () => {
  it("is on in Windows Terminal and overridable both ways", () => {
    expect(sixelSupported({ WT_SESSION: "x" })).toBe(true);
    expect(sixelSupported({})).toBe(false);
    expect(sixelSupported({ WT_SESSION: "x", TORLINK_COVERS: "blocks" })).toBe(false);
    expect(sixelSupported({ TORLINK_COVERS: "sixel" })).toBe(true);
  });
});

describe("overlay", () => {
  it("draws the image before the frame's closing marker, at the box's screen cell", () => {
    const { stream, out } = fakeStream();
    uninstall = installOverlay(stream);
    setOverlayImage({ node: tree(), sixel: "<IMG>", dx: 1, dy: 2 });
    stream.write(BSU);
    stream.write("\x1b[2J\x1b[0fframe");
    stream.write(ESU);
    // row = 4 + 3 + 2 (+1), col = 5 + 60 + 1 (+1)
    expect(out).toEqual([BSU, "\x1b[2J\x1b[0fframe", "\x1b7\x1b[10;67H<IMG>\x1b8", ESU]);
  });

  it("moves up from Ink's cursor when the frame wasn't a full clear", () => {
    const { stream, out } = fakeStream();
    uninstall = installOverlay(stream);
    setOverlayImage({ node: tree(), sixel: "<IMG>", dx: 0, dy: 0 });
    stream.write(BSU);
    stream.write("\x1b[2K\x1b[1Aframe\n");
    stream.write(ESU);
    // cursor sits on line 30 (root height, not fullscreen); box top is line 7.
    expect(out[2]).toBe("\x1b7\x1b[23A\r\x1b[66G<IMG>\x1b8");
  });

  it("draws nothing while the box is hidden", () => {
    const { stream, out } = fakeStream();
    uninstall = installOverlay(stream);
    setOverlayImage({ node: tree({ w: 0, h: 0 }), sixel: "<IMG>", dx: 0, dy: 0 });
    stream.write(BSU);
    stream.write("frame");
    stream.write(ESU);
    expect(out).toEqual([BSU, "frame", ESU]);
  });

  it("stops drawing once the image is cleared", () => {
    const { stream, out } = fakeStream();
    uninstall = installOverlay(stream);
    setOverlayImage({ node: tree(), sixel: "<IMG>", dx: 0, dy: 0 });
    setOverlayImage(null);
    stream.write(BSU);
    stream.write("frame");
    stream.write(ESU);
    expect(out.join("")).not.toContain("<IMG>");
  });
});
