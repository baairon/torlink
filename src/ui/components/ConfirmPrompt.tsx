import { Box, Text, useInput } from "ink";
import { COLOR, ICON } from "../theme";

interface ConfirmPromptProps {
  width?: number;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmPrompt({
  message,
  onConfirm,
  onCancel,
}: ConfirmPromptProps) {
  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === "n") onCancel();
    else if (key.return || input.toLowerCase() === "y") onConfirm();
  });

  return (
    <Box>
      <Text color={COLOR.warn}>{ICON.warn}  {message}</Text>
      <Text dimColor> (y/N)</Text>
    </Box>
  );
}
