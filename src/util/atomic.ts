import { promises as fs } from "node:fs";
import path from "node:path";

export interface WriteSerializer {
  (task: () => Promise<void>): Promise<void>;
  /** Resolves once every write queued so far has finished, failed or not. */
  flush(): Promise<void>;
}

// Serialize async writes to a single file so they never interleave. A failed
// write is logged — previously it vanished silently, leaving the UI showing
// state the disk didn't have — and the chain keeps going so one failure can't
// wedge later saves.
export function serializeWrites(): WriteSerializer {
  let chain: Promise<void> = Promise.resolve();
  const run = (task: () => Promise<void>): Promise<void> => {
    chain = chain.then(task).catch((err: unknown) => {
      console.error(
        `torlink: state save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return chain;
  };
  run.flush = () => chain;
  return run;
}

export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  // fsync before the rename: without it a crash between write and journal
  // flush can leave the renamed file zeroed or torn — the exact failure the
  // tmp+rename pattern exists to prevent.
  const handle = await fs.open(tmp, "w");
  try {
    await handle.writeFile(JSON.stringify(data, null, 2), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, file);
}
