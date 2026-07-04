import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { TextField } from "./TextField";
import { Panel } from "./Panel";
import type { DelugeConfig } from "../../config/config";
import { COLOR, ICON } from "../theme";

interface DelugeSettingsPromptProps {
  width: number;
  value: DelugeConfig | null;
  onSubmit: (config: DelugeConfig) => void;
  onCancel: () => void;
}

function sanitizeUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function DelugeSettingsPrompt({
  width,
  value,
  onSubmit,
  onCancel,
}: DelugeSettingsPromptProps) {
  const [url, setUrl] = useState(value?.url ?? "");
  const [password, setPassword] = useState(value?.password ?? "");
  const [focus, setFocus] = useState<"url" | "password">("url");

  useInput((_input, key) => {
    if (key.escape) onCancel();
    else if (key.tab) setFocus(focus === "url" ? "password" : "url");
  });

  const submit = (): void => onSubmit({ url: sanitizeUrl(url), password });

  return (
    <Box flexDirection="column" width={width}>
      <Panel title="deluge connection" width={width} focused height={4}>
        <Box>
          <Text color={COLOR.accent}>{`${ICON.pointer} `}</Text>
          <Box flexGrow={1} minWidth={0}>
            <TextField
              isDisabled={focus !== "url"}
              defaultValue={url}
              placeholder="http://localhost:8112"
              onChange={setUrl}
              onSubmit={() => setFocus("password")}
              onExitDown={() => setFocus("password")}
            />
          </Box>
        </Box>
        <Box>
          <Text color={COLOR.accent}>{`${ICON.pointer} `}</Text>
          <Box flexGrow={1} minWidth={0}>
            <TextField
              isDisabled={focus !== "password"}
              defaultValue={password}
              placeholder="password"
              mask
              onChange={setPassword}
              onSubmit={submit}
            />
          </Box>
        </Box>
      </Panel>
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color={COLOR.alt}>tab</Text>
          <Text dimColor> switch field</Text>
          <Text dimColor>{`     ${ICON.dot}     `}</Text>
          <Text color={COLOR.alt}>↵</Text>
          <Text dimColor> save</Text>
          <Text dimColor>{`     ${ICON.dot}     `}</Text>
          <Text color={COLOR.alt}>esc</Text>
          <Text dimColor> cancel</Text>
        </Box>
        <Text dimColor>Deluge&apos;s Web UI address and password. Stored locally in your config.</Text>
      </Box>
    </Box>
  );
}
