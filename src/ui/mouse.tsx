import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import type { EventEmitter } from "node:events";
import { Box, useStdin, type BoxProps, type DOMElement } from "ink";

// Mouse support for the TUI. The terminal reports the mouse as SGR sequences
// (ESC [ < button ; col ; row M/m) on stdin, and Ink hands each one to every
// useInput listener as if it were typed. MouseProvider takes them off that
// channel before any listener sees them, turns the wheel into arrow keys, and
// routes a left click to the <Clickable> under the pointer.

export interface MouseEvent {
  kind: "press" | "release" | "wheel";
  /** 0 left, 1 middle, 2 right; for the wheel, -1 up and 1 down. */
  button: number;
  /** Zero-based cell, from the top-left corner of the screen. */
  x: number;
  y: number;
}

const SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

const MOTION = 32;
const WHEEL = 64;

export function parseMouse(token: string): MouseEvent | null {
  const m = SGR_MOUSE.exec(token);
  if (!m) return null;
  const code = Number(m[1]);
  const x = Number(m[2]) - 1;
  const y = Number(m[3]) - 1;
  if (code & WHEEL) return { kind: "wheel", button: code & 1 ? 1 : -1, x, y };
  // Drags are reported as presses with the motion bit set; a drag is not a
  // click, so it is reported as a release and ignored downstream.
  const kind = m[4] === "M" && !(code & MOTION) ? "press" : "release";
  return { kind, button: code & 3, x, y };
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where a rendered Box sits on screen, or null when it is not showing: Ink
 * hides the body with display="none" under the help sheet and the prompts,
 * and the hidden children keep the layout they last had.
 */
export function screenRect(node: DOMElement): Rect | null {
  const own = node.yogaNode;
  if (!own) return null;
  let left = 0;
  let top = 0;
  for (let cur: DOMElement | undefined = node; cur; cur = cur.parentNode) {
    if (!cur.yogaNode || cur.style.display === "none") return null;
    left += cur.yogaNode.getComputedLeft();
    top += cur.yogaNode.getComputedTop();
  }
  const width = own.getComputedWidth();
  const height = own.getComputedHeight();
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

/** Pointer position inside the clicked element, zero-based. */
export interface ClickPoint {
  x: number;
  y: number;
}

type ClickHandler = (at: ClickPoint) => void;

interface Target {
  ref: RefObject<DOMElement | null>;
  onClick: RefObject<ClickHandler | undefined>;
}

interface Mouse {
  /** Feed bytes to the app as if typed; how a clicked hint runs its key. */
  press: (bytes: string) => void;
  register: (target: Target) => () => void;
}

const NO_MOUSE: Mouse = { press: () => {}, register: () => () => {} };

const MouseContext = createContext<Mouse>(NO_MOUSE);

/** No-ops outside a MouseProvider, so components render the same without one. */
export function useMouse(): Pick<Mouse, "press"> {
  return useContext(MouseContext);
}

const MOUSE_ON = "\x1b[?1000h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1000l\x1b[?1006l";
const ARROW_UP = "\x1b[A";
const ARROW_DOWN = "\x1b[B";

export function MouseProvider({
  reporting = false,
  children,
}: {
  /** Ask the terminal to report the mouse. Only the real app does; tests feed sequences in directly. */
  reporting?: boolean;
  children: ReactNode;
}) {
  // Ink parses stdin into one token per key or escape sequence and fans each
  // out on this emitter; it is the only place to catch a mouse report whole
  // and before useInput. Ink leaves it off useStdin's public type.
  const { internal_eventEmitter: emitter } = useStdin() as unknown as {
    internal_eventEmitter: EventEmitter;
  };
  const targets = useRef(new Set<Target>());
  const typed = useRef<(bytes: string) => void>(() => {});

  useEffect(() => {
    if (!reporting) return;
    process.stdout.write(MOUSE_ON);
    return () => {
      process.stdout.write(MOUSE_OFF);
    };
  }, [reporting]);

  useEffect(() => {
    const emit = emitter.emit;
    const type = (bytes: string): void => {
      emit.call(emitter, "input", bytes);
    };
    typed.current = type;

    const click = (x: number, y: number): void => {
      // Innermost wins: a row inside a panel is smaller than the panel.
      let best: { handler: ClickHandler; at: ClickPoint; area: number } | null = null;
      for (const target of targets.current) {
        const handler = target.onClick.current;
        const node = target.ref.current;
        if (!handler || !node) continue;
        const r = screenRect(node);
        if (!r) continue;
        if (x < r.left || x >= r.left + r.width || y < r.top || y >= r.top + r.height) continue;
        const area = r.width * r.height;
        if (!best || area <= best.area) {
          best = { handler, at: { x: x - r.left, y: y - r.top }, area };
        }
      }
      best?.handler(best.at);
    };

    emitter.emit = function patched(this: unknown, event: string | symbol, ...args: unknown[]) {
      if (event === "input" && typeof args[0] === "string") {
        const mouse = parseMouse(args[0]);
        if (mouse) {
          if (mouse.kind === "wheel") type(mouse.button < 0 ? ARROW_UP : ARROW_DOWN);
          else if (mouse.kind === "press" && mouse.button === 0) click(mouse.x, mouse.y);
          return true;
        }
      }
      return emit.call(this, event, ...args);
    } as typeof emitter.emit;

    return () => {
      emitter.emit = emit;
      typed.current = () => {};
    };
  }, [emitter]);

  const mouse = useMemo<Mouse>(
    () => ({
      press: (bytes) => typed.current(bytes),
      register: (target) => {
        targets.current.add(target);
        return () => {
          targets.current.delete(target);
        };
      },
    }),
    [],
  );

  return <MouseContext.Provider value={mouse}>{children}</MouseContext.Provider>;
}

/** A Box that runs onClick when it is left-clicked. Renders exactly as a Box. */
export function Clickable({
  onClick,
  children,
  ...box
}: BoxProps & { onClick?: ClickHandler; children?: ReactNode }) {
  const ref = useRef<DOMElement>(null);
  const handler = useRef(onClick);
  handler.current = onClick;
  const { register } = useContext(MouseContext);
  useEffect(() => register({ ref, onClick: handler }), [register]);
  return (
    <Box ref={ref} {...box}>
      {children}
    </Box>
  );
}

/**
 * The bytes a key hint stands for, or null when it names more than one key
 * ("↑↓←→") and so cannot be run by a click.
 */
export function hintBytes(keys: string): string | null {
  if (keys === "↵") return "\r";
  if (keys === "tab" || keys === "⇥") return "\t";
  if (keys === "esc") return "\x1b";
  if (keys === "␣") return " ";
  if (keys === "^c") return "\x03";
  return [...keys].length === 1 ? keys : null;
}
