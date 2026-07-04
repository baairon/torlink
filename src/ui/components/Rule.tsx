import { Text } from "ink";
import { RULE } from "../theme";

export function Rule({ width }: { width: number }) {
  return <Text color={RULE}>{"─".repeat(Math.max(1, width))}</Text>;
}
