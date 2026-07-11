import { useState } from "react";
import { Text, useInput } from "ink";

export interface TextFieldProps {
  isDisabled?: boolean;
  defaultValue?: string;
  placeholder?: string;
  width?: number;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onExitDown?: () => void;
  onExitLeft?: () => void;
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

export function deleteAt(value: string, cursor: number): Edit {
  if (cursor === value.length) return { value, cursor };
  return {
    value: value.slice(0, cursor) + value.slice(cursor + 1),
    cursor,
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
  width,
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
      if (key.delete) {
        apply(deleteAt(value, cursor));
        return;
      }
      if (key.backspace) {
        apply(deleteBefore(value, cursor));
        return;
      }
      if (key.meta || !input) return;
      const text = input
        .replace(/\x1b?\[<\d+;\d+;\d+[Mm]/g, "") // SGR mouse
        .replace(/\x1b\[20[01]~/g, "") // Bracketed paste
        .replace(/[\r\n]+/g, ""); // Newlines
      if (!text) return;
      apply(insertAt(value, cursor, text));
    },
    { isActive: !isDisabled },
  );

  if (isDisabled) {
    return value ? <Text>{value}</Text> : <Text dimColor>{placeholder}</Text>;
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

  // Compute a viewport window that keeps the cursor visible.
  // The cursor char itself always occupies 1 column inside the viewport.
  const viewW = width && width > 0 ? width : Infinity;
  let viewStart = 0;
  if (value.length + 1 > viewW) {
    // Ensure cursor position is visible: keep at least 1 char of context
    // after the cursor when possible.
    const cursorScreenPos = cursor; // 0-indexed position in full string
    if (cursorScreenPos >= viewW - 1) {
      viewStart = cursorScreenPos - viewW + 2;
    }
  }
  const viewEnd = viewStart + viewW;

  const before = value.slice(Math.max(viewStart, 0), cursor);
  const atChar = value[cursor] ?? CURSOR;
  const after =
    cursor < value.length ? value.slice(cursor + 1, Math.min(value.length, viewEnd)) : "";
  return (
    <Text>
      {before}
      <Text inverse>{atChar}</Text>
      {after}
    </Text>
  );
}
