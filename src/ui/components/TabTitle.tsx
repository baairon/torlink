import { useEffect } from "react";

export function TabTitle() {
  useEffect(() => {
    process.stdout.write("\x1b]0;torlink\x07");
    if (process.platform === "win32") process.title = "torlink";
  }, []);

  return null;
}
