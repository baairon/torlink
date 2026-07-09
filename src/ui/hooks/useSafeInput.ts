import { useInput, useStdin, type Key } from "ink";

type InputHandler = (input: string, key: Key) => void;

/** useInput that never activates when stdin is not a TTY (Docker without -it, pipes). */
export function useSafeInput(
  handler: InputHandler,
  options?: { isActive?: boolean },
): void {
  const { isRawModeSupported } = useStdin();
  const isActive = (options?.isActive ?? true) && isRawModeSupported;
  useInput(handler, { ...options, isActive });
}
