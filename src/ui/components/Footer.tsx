import { Text } from "ink";
import { COLOR } from "../theme";
import { HINT_GAP, hintAt, type Hint } from "../keymap";
import { Clickable, hintBytes } from "../mouse";

export function Footer({
  hints,
  onPress,
}: {
  hints: Hint[];
  /** Runs a clicked hint's key. Hints that name several keys are not clickable. */
  onPress?: (bytes: string) => void;
}) {
  return (
    <Clickable
      onClick={({ x }) => {
        const hint = hintAt(hints, x);
        const bytes = hint ? hintBytes(hint.keys) : null;
        if (bytes) onPress?.(bytes);
      }}
    >
      {/* App budgets exactly one row for the footer, so the hints truncate
          rather than wrapping and pushing the layout past the terminal. */}
      <Text wrap="truncate-end">
        {hints.map((h, i) => (
          <Text key={h.keys + h.label}>
            {i > 0 ? <Text dimColor>{HINT_GAP}</Text> : null}
            <Text color={COLOR.alt}>{h.keys}</Text>
            <Text dimColor>{` ${h.label}`}</Text>
          </Text>
        ))}
      </Text>
    </Clickable>
  );
}
