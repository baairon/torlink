import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  getGraphicsTier,
  graphicsMarker,
  graphicsOverride,
  probeGraphics,
  setGraphicsTier,
} from "./graphics";
import type { Env, ProbeIo } from "./graphics";

// A terminal is a pair of streams and an environment, which is all this module ever touches — so
// the whole detector is testable without one. Shaped like testHarness.ts's fake stdin: a real
// PassThrough (Ink's own reader needs one, and so does anything listening for "data") with the tty
// members streams lack bolted on.
type FakeStdin = PassThrough & {
  isTTY: boolean;
  isRaw: boolean;
  setRawMode: (v: boolean) => void;
  ref: () => void;
  unref: () => void;
};

interface FakeIo {
  /** Everything written to the fake tty, which several tests assert is nothing at all. */
  readonly writes: string[];
  /** Every setRawMode argument, in order: the probe has to hand back what it borrowed. */
  readonly rawModes: boolean[];
  readonly stdin: FakeStdin;
  readonly io: ProbeIo;
}

function fakeIo(env: Env, opts: { stdinTty?: boolean; stdoutTty?: boolean } = {}): FakeIo {
  const stdin = new PassThrough() as FakeStdin;
  const rawModes: boolean[] = [];
  stdin.isTTY = opts.stdinTty ?? true;
  stdin.isRaw = false;
  stdin.setRawMode = (v: boolean): void => {
    rawModes.push(v);
    stdin.isRaw = v;
  };
  stdin.ref = (): void => {};
  stdin.unref = (): void => {};

  const writes: string[] = [];
  const stdout = {
    isTTY: opts.stdoutTty ?? true,
    write(chunk: unknown): boolean {
      writes.push(String(chunk));
      return true;
    },
  };

  return {
    writes,
    rawModes,
    stdin,
    io: {
      env,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
    },
  };
}

// Everything a candidate terminal has to have before the probe is even written.
const KITTY_ENV: Env = { TERM: "xterm-kitty", COLORTERM: "truecolor" };

// The exact bytes the probe writes, pinned whole rather than by prefix and suffix. The payload
// sits in the middle, which is where a stray `=` of base64 padding hid: Ghostty length-checks the
// pixel before it answers, so `AAAA=` bought a bare DA1 and nothing else, and the kitty tier was
// unreachable. A test that knew only the two ends could not see it.
const QUERY_BYTES = "\u001b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\u001b\\\u001b[c";

// The two halves of a real answer, kept apart because a real tty delivers them apart.
const GRAPHICS_OK = "\u001b_Gi=31;OK\u001b\\";
const DA1 = "\u001b[?62;22;52c";
const OK_REPLY = GRAPHICS_OK + DA1;
const DA1_ONLY = "\u001b[?62;1;6c";

/** Lets the PassThrough deliver what has been written before the test looks again. */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

describe("graphicsOverride", () => {
  it("reads the user's answer in every spelling the flag takes", () => {
    expect(graphicsOverride({ TORLINK_GRAPHICS: "off" })).toBe("off");
    expect(graphicsOverride({ TORLINK_GRAPHICS: " OFF " })).toBe("off");
    expect(graphicsOverride({ TORLINK_GRAPHICS: "0" })).toBe("off");
    expect(graphicsOverride({ TORLINK_GRAPHICS: "none" })).toBe("off");
    expect(graphicsOverride({ TORLINK_GRAPHICS: "kitty" })).toBe("kitty");
    expect(graphicsOverride({ TORLINK_GRAPHICS: "KITTY" })).toBe("kitty");
  });

  it("has no opinion when the flag is unset or says something else", () => {
    expect(graphicsOverride({})).toBeNull();
    expect(graphicsOverride({ TORLINK_GRAPHICS: "" })).toBeNull();
    expect(graphicsOverride({ TORLINK_GRAPHICS: "sixel" })).toBeNull();
  });
});

describe("graphicsMarker", () => {
  it("accepts the terminal families that implement Unicode placeholders", () => {
    expect(graphicsMarker(KITTY_ENV, true)).toBe(true);
    expect(graphicsMarker({ COLORTERM: "truecolor", KITTY_WINDOW_ID: "1" }, true)).toBe(true);
    expect(graphicsMarker({ COLORTERM: "24bit", TERM_PROGRAM: "ghostty" }, true)).toBe(true);
  });

  it("refuses WezTerm, which draws images but not placeholders", () => {
    // WezTerm implements the graphics protocol, so it answers the query transmission with OK and
    // the probe cannot tell the difference — only this list can. Placeholders have been asked for
    // since 2023 and wezterm/wezterm#7924 is still open; until it lands, a marker here would buy
    // a poster-shaped hole rather than a poster. Two lines to add back when it does.
    expect(graphicsMarker({ COLORTERM: "truecolor", TERM_PROGRAM: "WezTerm" }, true)).toBe(false);
    expect(graphicsMarker({ FORCE_COLOR: "3", WEZTERM_PANE: "0" }, true)).toBe(false);
  });

  it("refuses a terminal that never said it draws images", () => {
    expect(graphicsMarker({ TERM: "xterm-256color", COLORTERM: "truecolor" }, true)).toBe(false);
    expect(graphicsMarker({ TERM: "alacritty", COLORTERM: "truecolor" }, true)).toBe(false);
  });

  it("refuses anything that is not a terminal at all", () => {
    expect(graphicsMarker(KITTY_ENV, false)).toBe(false);
    expect(graphicsMarker({ ...KITTY_ENV, CI: "true" }, true)).toBe(false);
  });

  it("refuses tmux, which is how torlnk attach runs the whole app", () => {
    expect(graphicsMarker({ ...KITTY_ENV, TMUX: "/tmp/tmux-1000/default,123,0" }, true)).toBe(false);
    expect(graphicsMarker({ ...KITTY_ENV, TERM: "tmux-256color" }, true)).toBe(false);
    expect(graphicsMarker({ ...KITTY_ENV, TERM: "screen.xterm-kitty" }, true)).toBe(false);
  });

  it("refuses anything short of certain truecolour", () => {
    // Not fussiness: the image id *is* a 24-bit colour, so a downgraded palette does not dim the
    // picture, it addresses a different image.
    expect(graphicsMarker({ TERM: "xterm-kitty" }, true)).toBe(false);
    expect(graphicsMarker({ TERM: "xterm-kitty", COLORTERM: "256color" }, true)).toBe(false);
    expect(graphicsMarker({ TERM: "xterm-kitty", FORCE_COLOR: "1" }, true)).toBe(false);
  });
});

describe("probeGraphics", () => {
  it("answers the override without asking the terminal anything", async () => {
    const off = fakeIo({ ...KITTY_ENV, TORLINK_GRAPHICS: "off" });
    expect(await probeGraphics(off.io)).toBeNull();
    expect(off.writes).toEqual([]);

    // The manual-test gate: forcing the tier skips the probe, so it works on a terminal that
    // cannot be asked and on one that could be but is not.
    const forced = fakeIo({ TORLINK_GRAPHICS: "kitty" }, { stdoutTty: false });
    expect(await probeGraphics(forced.io)).toBe("kitty");
    expect(forced.writes).toEqual([]);
  });

  it("writes nothing at all without a marker", async () => {
    // The no-stray-bytes guarantee. A terminal that cannot parse an APC escape *prints* it, so
    // being wrong here costs a screenful of garbage rather than a missing picture.
    for (const env of [
      { TERM: "xterm-256color", COLORTERM: "truecolor" },
      { ...KITTY_ENV, TMUX: "/tmp/tmux-1000/default,1,0" },
      { ...KITTY_ENV, CI: "1" },
      { TERM: "xterm-kitty" },
    ]) {
      const io = fakeIo(env);
      expect(await probeGraphics(io.io)).toBeNull();
      expect(io.writes).toEqual([]);
      expect(io.rawModes).toEqual([]);
    }
  });

  it("writes nothing when stdout is not a terminal", async () => {
    const io = fakeIo(KITTY_ENV, { stdoutTty: false });
    expect(await probeGraphics(io.io)).toBeNull();
    expect(io.writes).toEqual([]);
  });

  it("writes nothing when stdin cannot be put in raw mode", async () => {
    // Piped stdin: the terminal would answer into the line discipline, not to us.
    const io = fakeIo(KITTY_ENV, { stdinTty: false });
    expect(await probeGraphics(io.io)).toBeNull();
    expect(io.writes).toEqual([]);
  });

  it("takes an OK to the graphics query as the tier", async () => {
    const io = fakeIo(KITTY_ENV);
    const answer = probeGraphics(io.io);
    io.stdin.write(OK_REPLY);
    expect(await answer).toBe("kitty");
    // One write, carrying the query and the device-attributes fence behind it, byte for byte.
    expect(io.writes).toEqual([QUERY_BYTES]);
  });

  it("holds the OK until the fence arrives, and leaves nothing readable behind", async () => {
    // A real tty delivers the graphics reply and the DA1 as separate reads. Resolving on the first
    // leaves the second in stdin, and pausing does not discard it: Ink reads it moments later and
    // types "[?62;22;52c" into the search field.
    const io = fakeIo(KITTY_ENV);
    let settled = false;
    const answer = probeGraphics(io.io).then((t) => {
      settled = true;
      return t;
    });

    io.stdin.write(GRAPHICS_OK);
    await settle();
    expect(settled).toBe(false);

    io.stdin.write(DA1);
    expect(await answer).toBe("kitty");
    expect(io.stdin.read()).toBeNull();
  });

  it("throws away the tail of the answer rather than leave it for Ink", async () => {
    // Two reads already waiting when the probe attaches its listener, which is the arrangement a
    // real tty produces when the terminal's answer spans more than one read: the flow loop hands
    // over the first, the probe settles on it, and the second is still in the buffer. pause() does
    // not discard that — Ink reads stdin moments later and would type it — so finish() reads it
    // off and drops it. Here the tail is a second report the terminal volunteered, the very
    // "[?62;22;52c" the search field must never see.
    const io = fakeIo(KITTY_ENV);
    io.stdin.write(OK_REPLY);
    io.stdin.write(DA1_ONLY);
    await settle();

    expect(await probeGraphics(io.io)).toBe("kitty");
    expect(io.stdin.read()).toBeNull();
  });

  it("keeps an OK whose fence never comes, and still ends clean", async () => {
    // The 200 ms is the whole probe budget and not each half of it, so a terminal that answers the
    // graphics query and then goes quiet costs the wait but keeps the tier it earned.
    vi.useFakeTimers();
    try {
      const io = fakeIo(KITTY_ENV);
      const answer = probeGraphics(io.io);
      io.stdin.write(GRAPHICS_OK);
      await vi.advanceTimersByTimeAsync(500);
      expect(await answer).toBe("kitty");
      expect(io.rawModes).toEqual([true, false]);
      expect(io.stdin.listenerCount("data")).toBe(0);
      expect(io.stdin.isPaused()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes the device-attributes reply as a definite no", async () => {
    // The fence: a terminal that ignored the graphics escape still answers this one, so a
    // negative costs a round trip instead of the timeout.
    const io = fakeIo(KITTY_ENV);
    const answer = probeGraphics(io.io);
    io.stdin.write(DA1_ONLY);
    expect(await answer).toBeNull();
  });

  it("takes a graphics reply that is not OK as a no", async () => {
    const io = fakeIo(KITTY_ENV);
    const answer = probeGraphics(io.io);
    io.stdin.write("\u001b_Gi=31;ENOTSUPPORTED:bad\u001b\\" + DA1);
    expect(await answer).toBeNull();
  });

  it("gives up on a terminal that answers nothing", async () => {
    vi.useFakeTimers();
    try {
      const io = fakeIo(KITTY_ENV);
      const answer = probeGraphics(io.io);
      await vi.advanceTimersByTimeAsync(500);
      expect(await answer).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves stdin exactly as it found it", async () => {
    // Ink sets up raw mode and its own reader moments later and must find them untouched.
    const io = fakeIo(KITTY_ENV);
    const answer = probeGraphics(io.io);
    io.stdin.write(OK_REPLY);
    await answer;
    expect(io.rawModes).toEqual([true, false]);
    expect(io.stdin.isRaw).toBe(false);
    expect(io.stdin.listenerCount("data")).toBe(0);
    expect(io.stdin.isPaused()).toBe(true);
  });
});

describe("the tier", () => {
  it("is half-blocks until something says otherwise", () => {
    expect(getGraphicsTier()).toBeNull();
    setGraphicsTier("kitty");
    expect(getGraphicsTier()).toBe("kitty");
    setGraphicsTier(null);
    expect(getGraphicsTier()).toBeNull();
  });
});
