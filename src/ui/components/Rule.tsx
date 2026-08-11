import { Text } from "ink";
import { rule } from "../theme";

export function Rule({ width }: { width: number }) {
  return <Text color={rule()}>{"─".repeat(Math.max(1, width))}</Text>;
}
