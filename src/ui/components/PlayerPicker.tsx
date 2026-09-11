import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useStore } from "../store";
import { COLOR, ICON } from "../theme";
import { Panel } from "./Panel";
import { Spinner } from "./Spinner";
import {
  availableLocalPlayers,
  launchLocalPlayer,
  startCastDiscovery,
  type CastDevice,
  type CastStatus,
  type LocalPlayer,
} from "../../util/players";

interface PlayerPickerProps {
  target: { id: string; name: string };
  onLaunch: (launcher: () => void, deviceName: string) => void;
  onStatus?: (status: CastStatus) => void;
  onCancel: () => void;
}

type Player = LocalPlayer | CastDevice;

// ponytail: single glyphs, no Nerd Font dependency — matches ICON set in theme.ts.
const KIND_GLYPH: Record<Player["kind"], string> = {
  local: "▶",
  chromecast: "⌾",
  airplay: "⌁",
};

const KIND_LABEL: Record<Player["kind"], string> = {
  local: "this mac",
  chromecast: "chromecast",
  airplay: "airplay",
};

export function PlayerPicker({ target, onLaunch, onStatus, onCancel }: PlayerPickerProps) {
  const { contentWidth } = useStore();
  const [players, setPlayers] = useState<Player[]>(() => availableLocalPlayers());
  const [cursor, setCursor] = useState(0);
  const [scanning, setScanning] = useState(true);
  const url = `http://127.0.0.1:9162/webtorrent/${target.id}/`;

  useEffect(() => {
    const stop = startCastDiscovery((device) => {
      setPlayers((current) => current.some((item) => item.name === device.name) ? current : [...current, device]);
      setScanning(false);
    }, onStatus);
    const timer = setTimeout(() => setScanning(false), 10000);
    return () => {
      clearTimeout(timer);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- discovery starts once per mount
  }, []);

  // Group by kind so the list reads as: this mac, then cast devices. Discovery
  // arrives async, so grouping happens at render, not on insert.
  const groups: Player["kind"][] = ["local", "chromecast", "airplay"];
  const rows: { player: Player; groupLabel?: string }[] = [];
  for (const kind of groups) {
    const members = players.filter((p) => p.kind === kind);
    if (members.length === 0) continue;
    const showLabel = players.some((p) => p.kind !== "local");
    if (showLabel && members.length > 1) rows.push({ player: members[0]!, groupLabel: KIND_LABEL[kind] });
    for (const p of showLabel && members.length > 1 ? members.slice(1) : members) rows.push({ player: p });
  }

  const selectedIndex = Math.min(cursor, Math.max(0, rows.length - 1));
  const selected = rows[selectedIndex]?.player;
  useInput((input, key) => {
    if (key.escape) return onCancel();
    if (key.upArrow || input === "k") setCursor((value) => Math.max(0, value - 1));
    else if (key.downArrow || input === "j") setCursor((value) => Math.min(Math.max(0, rows.length - 1), value + 1));
    else if (key.return && selected) {
      onLaunch(() => {
        if (selected.kind === "local") launchLocalPlayer(selected, url);
        else selected.play(url);
      }, selected.name);
    }
  }, { isActive: true });

  return (
    <Box marginTop={1}>
      <Panel title="stream to" width={Math.max(24, Math.min(contentWidth, 62))} focused>
        <Box flexDirection="column">
          <Text dimColor>{truncate(target.name, Math.max(16, Math.min(contentWidth, 62) - 8))}</Text>
          <Box marginBottom={1} />
          {rows.length === 0 && !scanning ? <Text dimColor>No players found.</Text> : null}
          {rows.map(({ player, groupLabel }, index) => {
            const isCursor = index === selectedIndex;
            return (
              <Box key={`${player.kind}-${player.name}`} flexDirection="column">
                {groupLabel ? <Text dimColor>{groupLabel}</Text> : null}
                <Text color={isCursor ? COLOR.accent : undefined}>
                  {isCursor ? `${ICON.pointer} ` : "  "}
                  <Text color={isCursor ? COLOR.bright : COLOR.alt}>{KIND_GLYPH[player.kind]} </Text>
                  {player.name}
                </Text>
              </Box>
            );
          })}
          {scanning ? (
            <Spinner label="scanning for cast devices…" />
          ) : (
            <Text dimColor>↑↓/jk select  ↵ launch  esc cancel</Text>
          )}
        </Box>
      </Panel>
    </Box>
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
