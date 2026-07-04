import { useState } from "react";
import { Text, useInput } from "ink";

export interface TextFieldProps {
  isDisabled?: boolean;
  defaultValue?: string;
  placeholder?: string;
  mask?: boolean;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onExitDown?: () => void;
  onExitLeft?: () => void;
}

export function maskText(value: string): string {
  return "•".repeat(value.length);
}

interface Edit {
  value: string;
  cursor: number;
}

export function deleteBefore(value: string, cursor: number): Edit {
  if (cursor === 0) return { value, cursor };
  return {
    value: value.slice(0, cursor - 1) + value.slice(cursor),
    cursor: cursor - 1,
  };
}

export function deleteWordBefore(value: string, cursor: number): Edit {
  let i = cursor;
  while (i > 0 && value[i - 1] === " ") i--;
  while (i > 0 && value[i - 1] !== " ") i--;
  return { value: value.slice(0, i) + value.slice(cursor), cursor: i };
}

export function killToEnd(value: string, cursor: number): Edit {
  return { value: value.slice(0, cursor), cursor };
}

export function insertAt(value: string, cursor: number, text: string): Edit {
  return {
    value: value.slice(0, cursor) + text + value.slice(cursor),
    cursor: cursor + text.length,
  };
}

const CURSOR = " ";

export function TextField({
  isDisabled = false,
  defaultValue = "",
  placeholder = "",
  mask = false,
  onChange,
  onSubmit,
  onExitDown,
  onExitLeft,
}: TextFieldProps) {
  const [value, setValue] = useState(defaultValue);
  const [cursor, setCursor] = useState(defaultValue.length);

  function apply(next: Edit): void {
    setValue(next.value);
    setCursor(Math.max(0, Math.min(next.value.length, next.cursor)));
    if (next.value !== value) onChange?.(next.value);
  }

  useInput(
    (input, key) => {
      if (key.downArrow) {
        onExitDown?.();
        return;
      }
      if (key.upArrow || key.tab || (key.ctrl && input === "c")) return;

      if (key.return) {
        onSubmit?.(value);
        return;
      }

      if (key.ctrl) {
        switch (input) {
          case "u":
            apply({ value: "", cursor: 0 });
            return;
          case "w":
            apply(deleteWordBefore(value, cursor));
            return;
          case "k":
            apply(killToEnd(value, cursor));
            return;
          case "a":
            setCursor(0);
            return;
          case "e":
            setCursor(value.length);
            return;
          default:
            return;
        }
      }

      if (key.leftArrow) {
        if (cursor === 0) {
          onExitLeft?.();
          return;
        }
        setCursor(cursor - 1);
        return;
      }
      if (key.rightArrow) {
        setCursor(Math.min(value.length, cursor + 1));
        return;
      }
      if (key.backspace || key.delete) {
        apply(deleteBefore(value, cursor));
        return;
      }
      if (key.meta || !input) return;
      const text = input.replace(/\x1b?\[<\d+;\d+;\d+[Mm]/g, "");
      if (!text) return;
      apply(insertAt(value, cursor, text));
    },
    { isActive: !isDisabled },
  );

  const displayValue = mask ? maskText(value) : value;

  if (isDisabled) {
    return value ? <Text>{displayValue}</Text> : <Text dimColor>{placeholder}</Text>;
  }

  if (value.length === 0) {
    if (placeholder) {
      return (
        <Text>
          <Text inverse>{placeholder[0]}</Text>
          <Text dimColor>{placeholder.slice(1)}</Text>
        </Text>
      );
    }
    return <Text inverse>{CURSOR}</Text>;
  }

  const before = displayValue.slice(0, cursor);
  const atChar = displayValue[cursor] ?? CURSOR;
  const after = cursor < displayValue.length ? displayValue.slice(cursor + 1) : "";
  return (
    <Text>
      {before}
      <Text inverse>{atChar}</Text>
      {after}
    </Text>
  );
}
