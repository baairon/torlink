import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { TextField } from "./TextField";
import { Panel } from "./Panel";
import { PromptHints } from "./PromptHints";
import { COLOR, ICON } from "../theme";

interface SubtitleLangPromptProps {
  width: number;
  value: string;
  onSubmit: (lang: string) => void;
  onCancel: () => void;
}

export function SubtitleLangPrompt({ width, value, onSubmit, onCancel }: SubtitleLangPromptProps) {
  const [invalid, setInvalid] = useState(false);

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" width={width}>
      <Panel title="subtitle language" width={width} focused height={3}>
        <Box>
          <Text color={invalid ? COLOR.warn : undefined} dimColor={!invalid} wrap="truncate-end">
            {invalid ? "Use a 2-3 letter code, e.g. en, he, es" : "ISO code, e.g. en, he, es"}
          </Text>
        </Box>
        <Box>
          <Text color={COLOR.accent}>{`${ICON.pointer} `}</Text>
          <Box flexGrow={1} minWidth={0}>
            <TextField
              defaultValue={value}
              placeholder="en"
              width={Math.max(1, width - 6)}
              onChange={() => setInvalid(false)}
              onSubmit={(raw) => {
                const lang = raw.trim().toLowerCase();
                if (/^[a-z]{2,3}$/.test(lang)) onSubmit(lang);
                else setInvalid(true);
              }}
            />
          </Box>
        </Box>
      </Panel>
      <Box marginTop={1}>
        <PromptHints submitLabel="save" />
      </Box>
    </Box>
  );
}
