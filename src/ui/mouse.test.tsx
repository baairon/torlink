import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Clickable, MouseProvider, hintBytes, parseMouse, type ClickPoint } from "./mouse";
import { renderUI, type RenderedUI } from "./testHarness";

let ui: RenderedUI | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

// Records what reaches useInput, the way every key handler in the app sees it.
function Probe({ seen }: { seen: string[] }) {
  useInput((input, key) => {
    seen.push(key.upArrow ? "up" : key.downArrow ? "down" : input);
  });
  return null;
}

describe("parseMouse", () => {
  it("reads a left press with zero-based cells", () => {
    expect(parseMouse("\x1b[<0;10;5M")).toEqual({ kind: "press", button: 0, x: 9, y: 4 });
  });

  it("reads the release that follows a press", () => {
    expect(parseMouse("\x1b[<0;10;5m")).toEqual({ kind: "release", button: 0, x: 9, y: 4 });
  });

  it("keeps the button under modifier bits", () => {
    expect(parseMouse("\x1b[<18;1;1M")).toMatchObject({ kind: "press", button: 2 });
  });

  it("does not treat a drag as a press", () => {
    expect(parseMouse("\x1b[<32;3;3M")).toMatchObject({ kind: "release" });
  });

  it("reads the wheel", () => {
    expect(parseMouse("\x1b[<64;1;1M")).toMatchObject({ kind: "wheel", button: -1 });
    expect(parseMouse("\x1b[<65;1;1M")).toMatchObject({ kind: "wheel", button: 1 });
  });

  it("leaves keys alone", () => {
    expect(parseMouse("\x1b[A")).toBeNull();
    expect(parseMouse("d")).toBeNull();
  });
});

describe("hintBytes", () => {
  it("maps key hints to what the key sends", () => {
    expect(hintBytes("d")).toBe("d");
    expect(hintBytes("↵")).toBe("\r");
    expect(hintBytes("tab")).toBe("\t");
    expect(hintBytes("esc")).toBe("\x1b");
    expect(hintBytes("␣")).toBe(" ");
  });

  it("has nothing to send for a group of keys", () => {
    expect(hintBytes("↑↓←→")).toBeNull();
    expect(hintBytes("↑↓←→ / hjkl")).toBeNull();
  });
});

describe("MouseProvider", () => {
  it("keeps mouse reports away from key handlers", async () => {
    const seen: string[] = [];
    ui = renderUI(
      <MouseProvider>
        <Probe seen={seen} />
      </MouseProvider>,
    );
    ui.click(3, 3);
    ui.press("x");
    await vi.waitFor(() => expect(seen).toContain("x"));
    expect(seen).toEqual(["x"]);
  });

  it("turns the wheel into arrow keys", async () => {
    const seen: string[] = [];
    ui = renderUI(
      <MouseProvider>
        <Probe seen={seen} />
      </MouseProvider>,
    );
    ui.wheel("down");
    ui.wheel("up");
    await vi.waitFor(() => expect(seen).toEqual(["down", "up"]));
  });

  it("clicks the innermost element under the pointer", async () => {
    const outer = vi.fn<(at: ClickPoint) => void>();
    const inner = vi.fn<(at: ClickPoint) => void>();
    ui = renderUI(
      <MouseProvider>
        <Probe seen={[]} />
        <Clickable onClick={outer} flexDirection="column" paddingLeft={2} width={20}>
          <Text>first</Text>
          <Clickable onClick={inner} marginLeft={3}>
            <Text>second</Text>
          </Clickable>
        </Clickable>
      </MouseProvider>,
    );
    const u = ui;
    await vi.waitFor(() => expect(u.frame()).toContain("second"));

    u.click(7, 1); // the "c" of "second": 2 padding + 3 margin + 2
    await vi.waitFor(() => expect(inner).toHaveBeenCalledWith({ x: 2, y: 0 }));
    expect(outer).not.toHaveBeenCalled();

    u.click(2, 0); // "first" belongs to the outer box only
    await vi.waitFor(() => expect(outer).toHaveBeenCalledWith({ x: 2, y: 0 }));
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks that land on nothing, and other buttons", async () => {
    const onClick = vi.fn();
    const seen: string[] = [];
    ui = renderUI(
      <MouseProvider>
        <Probe seen={seen} />
        <Clickable onClick={onClick} width={4}>
          <Text>here</Text>
        </Clickable>
      </MouseProvider>,
    );
    const u = ui;
    await vi.waitFor(() => expect(u.frame()).toContain("here"));
    u.click(30, 0);
    u.press("\x1b[<2;1;1M"); // right button on the element
    u.press("z");
    await vi.waitFor(() => expect(seen).toEqual(["z"]));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not click what is hidden", async () => {
    const onClick = vi.fn();
    const seen: string[] = [];
    function Hidden({ hidden }: { hidden: boolean }) {
      return (
        <Box display={hidden ? "none" : "flex"}>
          <Clickable onClick={onClick}>
            <Text>here</Text>
          </Clickable>
        </Box>
      );
    }
    function Toggle() {
      const [hidden, setHidden] = useState(false);
      useInput((input) => {
        if (input === "h") setHidden(true);
      });
      return <Hidden hidden={hidden} />;
    }
    ui = renderUI(
      <MouseProvider>
        <Probe seen={seen} />
        <Toggle />
      </MouseProvider>,
    );
    const u = ui;
    await vi.waitFor(() => expect(u.frame()).toContain("here"));
    u.click(0, 0);
    await vi.waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
    u.press("h");
    await vi.waitFor(() => expect(u.frame()).not.toContain("here"));
    u.click(0, 0);
    u.press("z");
    await vi.waitFor(() => expect(seen).toContain("z"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders a Clickable without a provider", async () => {
    ui = renderUI(
      <Clickable onClick={() => {}}>
        <Text>plain</Text>
      </Clickable>,
    );
    const u = ui;
    await vi.waitFor(() => expect(u.frame()).toContain("plain"));
  });
});
