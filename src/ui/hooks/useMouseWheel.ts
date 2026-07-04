import { useEffect } from "react";

export function useMouseWheel(): void {
  useEffect(() => {
    const { stdout, stdin } = process;

    stdout.write("\x1b[?1000h\x1b[?1006h");

    const handler = (data: Buffer): void => {
      const str = data.toString("utf8");
      const re = /\x1b\[<(64|65);\d+;\d+[Mm]/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(str)) !== null) {
        const arrow = match[1] === "64" ? "\x1b[A" : "\x1b[B";
        process.nextTick(() => stdin.emit("data", Buffer.from(arrow)));
      }
    };

    stdin.prependListener("data", handler);

    return () => {
      stdout.write("\x1b[?1000l\x1b[?1006l");
      stdin.removeListener("data", handler);
    };
  }, []);
}
