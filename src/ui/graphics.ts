// Which picture tier the terminal gets, decided once at startup.
//
// The half-block tier works everywhere and is the answer to every doubt here. The kitty tier is
// only ever chosen when the terminal has *said* it can draw images — by an environment marker and
// then by answering a query — because the failure mode of guessing wrong is not a missing picture
// but a screenful of garbage: a terminal that cannot parse an APC escape prints it. So this module
// is a series of vetoes, and it writes nothing to the tty until every one of them has passed.

/** The only tier besides half-blocks. A string rather than a boolean so a third can be added. */
export type GraphicsTier = "kitty" | null;

/** Just the environment: a plain record so tests can pass one without touching process.env. */
export type Env = Readonly<Record<string, string | undefined>>;

/** What the probe needs, narrow enough for a pair of PassThrough streams to satisfy it. */
export interface ProbeIo {
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  readonly env: Env;
}

/**
 * The user's answer, which overrules every signal below.
 *
 * `off` is the escape hatch for a terminal that passes the probe and still draws nothing — a real
 * possibility, since the query asks about graphics support and not about placeholder support.
 * `kitty` forces the tier without probing, which is the only way to exercise this path on a
 * machine whose terminal cannot be asked.
 */
export function graphicsOverride(env: Env): "off" | "kitty" | null {
  const raw = env.TORLINK_GRAPHICS?.trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "none") return "off";
  if (raw === "kitty") return "kitty";
  return null;
}

/**
 * Whether this environment is worth writing a probe into at all.
 *
 * Everything here is a veto except the last clause, and the vetoes are the point:
 *
 * - No tty, or CI: there is no terminal to answer, and the escape would land in a log.
 * - tmux, by `TMUX` or by a `screen`/`tmux` TERM. `torlnk attach` runs the whole TUI inside tmux,
 *   so this is the common case and not a corner: tmux multiplexes the graphics protocol badly or
 *   not at all, and the pane is redrawn from tmux's own buffer where the images are not.
 * - Anything short of certain truecolour. The image id travels as `38;2;r;g;b`, emitted by chalk
 *   on Ink's behalf; a chalk that downgrades the palette does not lose the picture, it names a
 *   *different image id*. This is checked through the environment rather than by reading chalk's
 *   level because chalk is Ink's dependency and not ours — importing it here would be a phantom
 *   dependency, which deps-pin.test.ts exists to say this repo does not take.
 * - Finally, a positive marker for a terminal family known to implement Unicode *placeholders*.
 *   Implementing the graphics protocol is not enough, and the list must not be widened to mean
 *   that: WezTerm accepts a query transmission and answers OK, but has never shipped placeholders
 *   (wezterm/wezterm#7924 is still open), so it would clear the probe below and then draw nothing
 *   at all. There is no query for placeholder support, which is exactly why this stays a family
 *   list rather than a capability check. Without a marker nothing is written, which is also what
 *   keeps a mis-sniff from printing escape text at a terminal that cannot parse it.
 */
export function graphicsMarker(env: Env, isTty: boolean): boolean {
  if (!isTty) return false;
  if (env.CI !== undefined && env.CI !== "") return false;
  if (env.TMUX !== undefined && env.TMUX !== "") return false;

  const term = env.TERM ?? "";
  if (term.startsWith("screen") || term.startsWith("tmux")) return false;

  const colorterm = env.COLORTERM?.toLowerCase() ?? "";
  const truecolor = colorterm === "truecolor" || colorterm === "24bit" || env.FORCE_COLOR === "3";
  if (!truecolor) return false;

  const program = env.TERM_PROGRAM?.toLowerCase() ?? "";
  return (
    term.includes("kitty") ||
    env.KITTY_WINDOW_ID !== undefined ||
    program === "ghostty" ||
    env.GHOSTTY_RESOURCES_DIR !== undefined
  );
}

// The probe: a one-pixel query transmission, then a primary device attributes request.
//
// `a=q` asks the terminal to answer whether it could accept this image without storing anything,
// and `i=31` is an id the reply echoes back. DA1 is the fence: every terminal ever made answers
// it, and it answers *after* the graphics reply, so a terminal that ignored the first escape still
// gives a fast definite negative instead of costing a timeout. Consuming both replies here is also
// what keeps them out of Ink's stdin, where parse-keypress would read them as a burst of keys.
//
// The payload is kitty's own documented detection string: `AAAA`, one base64 pixel. The trailing
// `=` that padding rules would put on a four-character group is one byte too many, and a terminal
// that length-checks before it answers — Ghostty does — discards the whole escape and sends only
// the DA1, which reads here as "no graphics". graphics.test.ts pins these bytes exactly for that
// reason: the bug lived in the middle of the string, where a prefix-and-suffix test could not see
// it.
const QUERY = "\u001b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\u001b\\\u001b[c";

// Long enough for a terminal on the far end of an ssh link to answer, short enough that a terminal
// which answers neither escape costs a fifth of a second at startup and nothing after.
const PROBE_MS = 200;

const GRAPHICS_REPLY = /\u001b_G([^\u001b]*)\u001b\\/;
const DA1_REPLY = /\u001b\[\?[0-9;]*c/;

/**
 * Ask the terminal, once, and answer with the tier.
 *
 * Never throws and never leaves the tty changed: raw mode goes back to what it was, the listener
 * comes off, and a stdin this function resumed is paused again — Ink sets all three up for itself
 * moments later and must find them as it left them.
 */
export async function probeGraphics(io: ProbeIo): Promise<GraphicsTier> {
  const override = graphicsOverride(io.env);
  if (override === "off") return null;
  if (override === "kitty") return "kitty";
  if (!graphicsMarker(io.env, io.stdout.isTTY === true)) return null;

  const { stdin, stdout } = io;
  // A terminal that can draw images but whose stdin we cannot put in raw mode would answer into
  // the line discipline instead of to us, so there is nothing to read and nothing to conclude.
  if (stdin.isTTY !== true || typeof stdin.setRawMode !== "function") return null;

  return await new Promise<GraphicsTier>((resolve) => {
    const wasRaw = stdin.isRaw === true;
    let settled = false;
    let seen = "";
    // The tier as soon as the graphics reply names it, held rather than returned: the DA1 fence is
    // still on its way, and resolving before it arrives leaves it in stdin for Ink to read as keys.
    let answer: GraphicsTier = null;

    const finish = (tier: GraphicsTier): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdin.off("data", onData);
      try {
        stdin.setRawMode(wasRaw);
      } catch {
        // A stdin that stopped being a tty mid-probe. The tier is the answer that matters.
      }
      // Listening resumed the stream; leaving it flowing would race Ink's own reader for the
      // user's first keystrokes. Pausing does not discard what is already buffered, though, so
      // anything of the terminal's answer that landed after the last "data" event is read off and
      // thrown away here — Ink reads stdin with "readable" + read() and would otherwise get it.
      // Both are gated on the same condition: a stdin that was already raw belongs to someone
      // else, and neither pausing it nor eating its bytes is ours to do.
      //
      // stdin.read() re-emits "data" for every chunk it returns. Harmless here — onData is already
      // off the stream by the time this runs, and nothing else is listening on process.stdin at
      // this point in startup — but a future caller that probes with its own "data" listener still
      // attached would be handed the tail of our reply as if it were live input.
      if (!wasRaw) {
        stdin.pause();
        try {
          while (stdin.read() !== null) {
            // Discarded on purpose: these are the tail of our own query's reply.
          }
        } catch {
          // A stdin that stopped being readable mid-probe has nothing left to leak.
        }
      }
      resolve(tier);
    };

    const onData = (chunk: Buffer | string): void => {
      // latin1: the replies are ASCII, and decoding as UTF-8 could stall on a split multi-byte
      // sequence from a keystroke typed into the same buffer.
      seen += typeof chunk === "string" ? chunk : chunk.toString("latin1");
      const graphics = GRAPHICS_REPLY.exec(seen);
      // Only the terminal's own `OK` counts. A reply naming an error is a terminal that parsed the
      // escape and refused it, which is still a terminal we must not draw into.
      if (graphics !== null) answer = graphics[1]?.includes("OK") === true ? "kitty" : null;
      // The DA1 comes last, so it is the terminal saying it has finished answering — and the byte
      // we must not leave behind. Only then is the probe over.
      if (DA1_REPLY.test(seen)) finish(answer);
    };

    // The 200 ms is the whole probe's ceiling, not each half's: a terminal that says OK and then
    // never sends its DA1 still gets the tier it earned, at the cost of the wait.
    const timer = setTimeout(() => finish(answer), PROBE_MS);

    try {
      stdin.setRawMode(true);
      stdin.on("data", onData);
      stdout.write(QUERY);
    } catch {
      finish(null);
    }
  });
}

// One process, one terminal, one answer — so the tier is module state rather than a prop threaded
// through the tree. Set once at startup, before anything renders; read by the poster hook, which
// is the only thing that has to know.
let tier: GraphicsTier = null;

export function setGraphicsTier(next: GraphicsTier): void {
  tier = next;
}

export function getGraphicsTier(): GraphicsTier {
  return tier;
}
