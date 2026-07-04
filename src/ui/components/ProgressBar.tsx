import { useEffect, useState } from "react";
import { Text } from "ink";
import { COLOR, RULE, lerpHex } from "../theme";
import { SHEEN_PEAK, SHEEN_TICK_MS, sheenCenter, sheenIntensity, sheenPeriod } from "../sheen";

const DEEP = "#7c5cd6";

interface Run {
  color: string;
  len: number;
}

function ramp(t: number, deep: string, mid: string, bright: string): string {
  return t <= 0.5 ? lerpHex(deep, mid, t / 0.5) : lerpHex(mid, bright, (t - 0.5) / 0.5);
}

function runs(colors: string[]): Run[] {
  const out: Run[] = [];
  for (const c of colors) {
    const prev = out[out.length - 1];
    if (prev && prev.color === c) prev.len++;
    else out.push({ color: c, len: 1 });
  }
  return out;
}

function paint(rs: Run[]) {
  return rs.map((r, i) => (
    <Text key={i} color={r.color}>
      {"█".repeat(r.len)}
    </Text>
  ));
}

export function ProgressBar({
  pct,
  width,
  color = COLOR.accent,
  animate = false,
}: {
  pct: number;
  width: number;
  color?: string;
  animate?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  const empty = Math.max(0, width - filled);
  const denom = Math.max(1, width - 1);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!animate) return;
    const timer = setInterval(() => setTick((v) => v + 1), SHEEN_TICK_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }, [animate]);

  const track = empty > 0 ? <Text color={RULE}>{"░".repeat(empty)}</Text> : null;

  if (filled === 0) return <Text>{track}</Text>;

  if (!animate) {
    const deep = lerpHex(color, "#000000", 0.3);
    const bright = lerpHex(color, COLOR.text, 0.35);
    const cells = Array.from({ length: filled }, (_, i) => ramp(i / denom, deep, color, bright));
    return (
      <Text>
        {paint(runs(cells))}
        {track}
      </Text>
    );
  }

  const period = sheenPeriod(width);
  const center = sheenCenter(tick, period);
  const cells = Array.from({ length: filled }, (_, i) => {
    let c = ramp(i / denom, DEEP, COLOR.accent, COLOR.bright);
    const intensity = sheenIntensity(i, center);
    if (intensity > 0) c = lerpHex(c, SHEEN_PEAK, intensity);
    return c;
  });

  return (
    <Text>
      {paint(runs(cells))}
      {track}
    </Text>
  );
}
