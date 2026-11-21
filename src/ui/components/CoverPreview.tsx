import { useEffect, useRef, useState } from "react";
import { Box, Text, type DOMElement } from "ink";
import { fitCells, loadPixels, toHalfBlocks } from "../cover";
import { overlayActive, setOverlayImage } from "../overlay";
import { CELL_H, CELL_W, encodeSixel, fitPixels, resize } from "../sixel";

// Waits for the cursor to settle so holding j/k through a list doesn't start
// a download for every row it passes.
const SETTLE_MS = 120;

interface Props {
  url: string | undefined;
  width: number;
  height: number;
}

type Shown =
  | { url: string; kind: "none" }
  | { url: string; kind: "blocks"; lines: string[] }
  | { url: string; kind: "sixel"; sixel: string; dx: number; dy: number };

function render(url: string, img: Parameters<typeof toHalfBlocks>[0] | null, width: number, height: number): Shown {
  if (!img) return { url, kind: "none" };
  if (!overlayActive()) {
    const { cols, rows } = fitCells(img.width, img.height, width, height);
    return { url, kind: "blocks", lines: toHalfBlocks(img, cols, rows) };
  }
  const { w, h } = fitPixels(img.width, img.height, width * CELL_W, height * CELL_H);
  const cols = Math.ceil(w / CELL_W);
  const rows = Math.ceil(h / CELL_H);
  return {
    url,
    kind: "sixel",
    sixel: encodeSixel(resize(img, w, h)),
    dx: Math.floor((width - cols) / 2),
    dy: Math.floor((height - rows) / 2),
  };
}

export function CoverPreview({ url, width, height }: Props) {
  const [shown, setShown] = useState<Shown | null>(null);
  const box = useRef<DOMElement>(null);

  useEffect(() => {
    if (!url) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      loadPixels(url, ctl.signal)
        .then((img) => {
          if (!ctl.signal.aborted) setShown(render(url, img, width, height));
        })
        .catch(() => {});
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [url, width, height]);

  const current = shown && shown.url === url ? shown : null;

  useEffect(() => {
    if (current?.kind !== "sixel" || !box.current) return;
    setOverlayImage({ node: box.current, sixel: current.sixel, dx: current.dx, dy: current.dy });
    return () => setOverlayImage(null);
  }, [current]);

  return (
    <Box
      ref={box}
      width={width}
      height={height}
      flexShrink={0}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      {current === null ? (
        url ? <Text dimColor>loading cover…</Text> : null
      ) : current.kind === "none" ? (
        <Text dimColor>no preview</Text>
      ) : current.kind === "blocks" ? (
        current.lines.map((line, i) => <Text key={i}>{line}</Text>)
      ) : null}
    </Box>
  );
}
