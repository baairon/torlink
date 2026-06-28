import { Box, Text, useInput } from "ink";
import { useStore, useQueueItems, CATEGORIES, type Section } from "../store";
import { wrapStep } from "../move";
import { ACCENT_RAMP, COLOR, GUTTER, ICON, RULE } from "../theme";

interface NavItem {
  key: Section;
  label: string;
}

const FILTERS: NavItem[] = CATEGORIES.map((c) => ({
  key: c.key as Section,
  label: c.label,
}));
const LIBRARY: NavItem[] = [
  { key: "downloads", label: "Downloads" },
  { key: "seeding", label: "Seeding" },
];

const BADGED = (key: Section): boolean => key === "downloads" || key === "seeding";

const GROUPS: NavItem[][] = [FILTERS, LIBRARY];

const NAV: NavItem[] = GROUPS.flat();

const BADGE_W = " (00)".length;

export const RAIL_WIDTH =
  GUTTER + Math.max(...NAV.map((n) => n.label.length + (BADGED(n.key) ? BADGE_W : 0)));

export function Sidebar() {
  const { section, setSection, region, setRegion, queue } = useStore();
  const focused = region === "sidebar";
  const idx = Math.max(0, NAV.findIndex((n) => n.key === section));
  useQueueItems(queue);
  const active = queue.activeCount;
  const seeding = queue.seedingCount;

  useInput(
    (input, key) => {
      if (key.upArrow || input === "k") setSection(NAV[wrapStep(idx, -1, NAV.length)]!.key);
      else if (key.downArrow || input === "j") setSection(NAV[wrapStep(idx, 1, NAV.length)]!.key);
      else if (key.return) setRegion("content");
    },
    { isActive: focused },
  );

  return (
    <Box flexDirection="column" width={RAIL_WIDTH} marginRight={1}>
      {GROUPS.map((items, gi) => (
        <Box key={gi} flexDirection="column" marginTop={gi > 0 ? 1 : 0}>
          {items.map((item) => {
            const selected = item.key === section;
            return (
              <Box key={item.key}>
                <Box width={GUTTER} flexShrink={0}>
                  {selected ? (
                    <Text color={focused ? ACCENT_RAMP[1] : RULE} bold={focused}>
                      {ICON.bar}
                    </Text>
                  ) : null}
                </Box>
                <Text
                  color={selected ? (focused ? COLOR.accent : COLOR.alt) : undefined}
                  dimColor={!selected}
                  bold={selected && focused}
                >
                  {item.label}
                </Text>
                {(() => {
                  const n = item.key === "downloads" ? active : item.key === "seeding" ? seeding : 0;
                  return n > 0 ? (
                    <Box flexShrink={0}>
                      <Text dimColor>{` (${n})`}</Text>
                    </Box>
                  ) : null;
                })()}
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
