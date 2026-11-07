import type { DOMElement } from "ink";

// Draws one Sixel image over a reserved box in Ink's output.
//
// Ink repaints by erasing and rewriting its lines, which wipes any image
// under them, so the image is written again at the end of every frame. Ink
// brackets each frame in synchronized-output markers (BSU ... ESU); the image
// goes in just before the ESU, so the terminal shows text and image together
// with no flash between them.
//
// Positioning: when Ink clears the screen first (always for a fullscreen frame
// on Windows) the frame starts at the top-left, so the box's layout offset is
// its screen position. Otherwise Ink leaves the cursor just past its last line
// and the box is reached by moving up from there.

const BSU = "\x1b[?2026h";
const ESU = "\x1b[?2026l";
const SAVE = "\x1b7";
const RESTORE = "\x1b8";
// A frame that set an image but never reached the screen is drawn on its own
// after this long.
const LATE_DRAW_MS = 60;

export interface OverlayImage {
  node: DOMElement;
  sixel: string;
  // Offset of the image's top-left cell inside the box.
  dx: number;
  dy: number;
}

type Write = NodeJS.WriteStream["write"];

let installed: { stream: NodeJS.WriteStream; write: Write } | null = null;
let current: OverlayImage | null = null;
let inFrame = false;
let frameKind: "clear" | "log" | null = null;
let lastKind: "clear" | "log" = "clear";
let drawnSinceSet = false;
let lateTimer: NodeJS.Timeout | null = null;

export function sixelSupported(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = env.TORLINK_COVERS?.toLowerCase();
  if (mode === "sixel") return true;
  if (mode === "blocks") return false;
  // Windows Terminal has drawn Sixel since 1.22.
  return Boolean(env.WT_SESSION);
}

export function overlayActive(): boolean {
  return installed !== null;
}

function offset(node: DOMElement): { x: number; y: number; root: DOMElement } | null {
  let x = 0, y = 0;
  let n: DOMElement | undefined = node;
  let root: DOMElement = node;
  while (n) {
    const yoga = n.yogaNode;
    if (!yoga) return null;
    x += yoga.getComputedLeft();
    y += yoga.getComputedTop();
    root = n;
    n = n.parentNode;
  }
  return root.nodeName === "ink-root" ? { x, y, root } : null;
}

function sequence(): string {
  if (!current || !installed) return "";
  const { node, sixel, dx, dy } = current;
  // A hidden box (display="none" up the tree) has no size: draw nothing.
  if (!node.yogaNode || node.yogaNode.getComputedWidth() === 0 || node.yogaNode.getComputedHeight() === 0)
    return "";
  const at = offset(node);
  if (!at) return "";
  const row = at.y + dy;
  const col = at.x + dx + 1;
  let move: string;
  if (lastKind === "clear") {
    move = `\x1b[${row + 1};${col}H`;
  } else {
    const height = at.root.yogaNode!.getComputedHeight();
    const rows = installed.stream.rows ?? 24;
    // A frame that fills the screen is written without its trailing newline.
    const cursorLine = height >= rows ? height - 1 : height;
    const up = cursorLine - row;
    move = (up > 0 ? `\x1b[${up}A` : "") + `\r\x1b[${col}G`;
  }
  drawnSinceSet = true;
  return SAVE + move + sixel + RESTORE;
}

export function installOverlay(stream: NodeJS.WriteStream = process.stdout): () => void {
  if (installed) return () => {};
  const write = stream.write.bind(stream) as Write;
  installed = { stream, write };
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === "string") {
      if (chunk === BSU) {
        inFrame = true;
        frameKind = null;
      } else if (chunk === ESU && inFrame) {
        inFrame = false;
        lastKind = frameKind ?? lastKind;
        const extra = sequence();
        if (extra) write(extra);
      } else if (inFrame && frameKind === null && chunk.length > 0) {
        frameKind = chunk.startsWith("\x1b[2J") ? "clear" : "log";
      }
    }
    return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as Write;
  return () => {
    stream.write = write;
    installed = null;
    current = null;
  };
}

export function setOverlayImage(image: OverlayImage | null): void {
  current = image;
  drawnSinceSet = false;
  if (lateTimer) clearTimeout(lateTimer);
  lateTimer = null;
  if (!image || !installed) return;
  lateTimer = setTimeout(() => {
    lateTimer = null;
    if (drawnSinceSet || current !== image || !installed) return;
    const seq = sequence();
    if (seq) installed.write(seq);
  }, LATE_DRAW_MS);
}
