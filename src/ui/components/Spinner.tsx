import { useEffect, useState } from "react";
import { Text } from "ink";
import { COLOR } from "../theme";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ label }: { label?: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    timer.unref?.();
    return () => clearInterval(timer);
  }, []);
  return (
    <Text>
      <Text color={COLOR.accent}>{FRAMES[frame]}</Text>
      {label ? <Text dimColor>{` ${label}`}</Text> : null}
    </Text>
  );
}
