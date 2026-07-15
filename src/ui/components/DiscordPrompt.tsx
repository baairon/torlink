import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { TextField } from "./TextField";
import { Panel } from "./Panel";
import { PromptHints } from "./PromptHints";
import { COLOR, ICON } from "../theme";
import type { DiscordConfig } from "../../config/config";

interface DiscordPromptProps {
  width: number;
  value?: DiscordConfig;
  onSubmit: (discord: DiscordConfig | undefined) => void;
  onCancel: () => void;
}

const FIELDS = [
  { key: "webhookUrl", label: "Webhook URL", placeholder: "https://discord.com/api/webhooks/…", secret: true },
  { key: "botToken", label: "Bot token", placeholder: "optional · enables commands", secret: true },
  { key: "channelId", label: "Channel ID", placeholder: "optional · channel to read", secret: false },
  { key: "allowedUsers", label: "Allowed users", placeholder: "optional · comma-separated ids", secret: false },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

const LABEL_W = 17;

export function DiscordPrompt({ width, value, onSubmit, onCancel }: DiscordPromptProps) {
  const [values, setValues] = useState<Record<FieldKey, string>>({
    webhookUrl: value?.webhookUrl ?? "",
    botToken: value?.botToken ?? "",
    channelId: value?.channelId ?? "",
    allowedUsers: (value?.allowedUserIds ?? []).join(", "),
  });
  const [focus, setFocus] = useState(0);

  // Arrow keys move between rows; the active field owns everything else. Both
  // this handler and the focused TextField see the key, but the field ignores
  // the vertical arrows, so only the move lands.
  useInput((_input, key) => {
    if (key.escape) return onCancel();
    if (key.upArrow) setFocus((f) => Math.max(0, f - 1));
    else if (key.downArrow) setFocus((f) => Math.min(FIELDS.length - 1, f + 1));
  });

  const save = (): void => {
    const trimmed = (k: FieldKey): string => values[k].trim();
    const webhookUrl = trimmed("webhookUrl") || undefined;
    const botToken = trimmed("botToken") || undefined;
    const channelId = trimmed("channelId") || undefined;
    const allowedUserIds = trimmed("allowedUsers")
      ? trimmed("allowedUsers").split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    if (!webhookUrl && !botToken && !channelId && !allowedUserIds) return onSubmit(undefined);
    onSubmit({ webhookUrl, botToken, channelId, allowedUserIds });
  };

  // A webhook alone is notifications only; commands need all four.
  const notifyOn = values.webhookUrl.trim() !== "";
  const commandsOn = (["webhookUrl", "botToken", "channelId", "allowedUsers"] as const).every(
    (k) => values[k].trim() !== "",
  );

  const fieldW = Math.max(1, width - LABEL_W - 6);

  return (
    <Box flexDirection="column" width={width}>
      {/* rows: one status line + one per field, plus the panel's bottom border */}
      <Panel title="discord" width={width} focused height={FIELDS.length + 2}>
        <Box>
          <Text dimColor>notifications </Text>
          <Text color={notifyOn ? COLOR.good : COLOR.alt}>{notifyOn ? "on" : "off"}</Text>
          <Text dimColor>{`  ${ICON.dot}  commands `}</Text>
          <Text color={commandsOn ? COLOR.good : COLOR.alt}>{commandsOn ? "on" : "off"}</Text>
        </Box>
        {FIELDS.map((f, i) => {
          const active = i === focus;
          return (
            <Box key={f.key}>
              <Box width={LABEL_W}>
                <Text color={active ? COLOR.accent : undefined} dimColor={!active} wrap="truncate-end">
                  {active ? `${ICON.pointer} ` : "  "}
                  {f.label}
                </Text>
              </Box>
              <Box flexGrow={1} minWidth={0}>
                {active ? (
                  <TextField
                    defaultValue={values[f.key]}
                    placeholder={f.placeholder}
                    width={fieldW}
                    onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                    onSubmit={save}
                  />
                ) : (
                  <Text dimColor wrap="truncate-end">
                    {values[f.key] ? (f.secret ? "•••••••• (set)" : values[f.key]) : f.placeholder}
                  </Text>
                )}
              </Box>
            </Box>
          );
        })}
      </Panel>
      <Box marginTop={1}>
        <Box marginRight={2}>
          <Text color={COLOR.alt}>↑↓</Text>
          <Text dimColor> fields</Text>
        </Box>
        <PromptHints submitLabel="save" />
      </Box>
    </Box>
  );
}
