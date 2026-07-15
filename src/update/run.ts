// `torlnk update`: fetch the latest release, apply it, and bring any --daemon
// process back on the new code. Two install shapes are handled: a git checkout
// (pull, install, build) and a global npm install (npm i -g), chosen by whether
// the package root is a git working tree.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../version";
import { fetchLatestVersion, isNewer } from "./version";
import { isAlive, listRunDescriptors, restartDaemon } from "../daemon/restart";

// npm is a shell script on Windows (npm.cmd), and spawning a .cmd there needs a
// shell; git is a real binary everywhere.
const IS_WIN = process.platform === "win32";
const NPM = IS_WIN ? "npm.cmd" : "npm";

// Walk up from this module to the torlnk package root. Robust across the bundled
// dist (dist/index.js -> ..), the tsx dev tree (src/update -> ../..), and a
// global install, instead of hard-coding a depth that only one of them matches.
function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(dir, "package.json");
    try {
      if ((JSON.parse(fs.readFileSync(pkg, "utf8")) as { name?: string }).name === "torlnk") {
        return dir;
      }
    } catch {
      // no package.json here, or not ours, so keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function run(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit", shell: IS_WIN });
    child.on("error", () => resolve(-1)); // e.g. command not found
    child.on("exit", (code) => resolve(code ?? -1));
  });
}

async function gitUpdate(root: string, force: boolean): Promise<boolean> {
  console.log("Pulling latest (git)…");
  if ((await run("git", ["-C", root, "pull", "--ff-only"], root)) !== 0) {
    // No upstream, a diverged branch, or a dirty tree. A plain update can't get
    // latest, so it stops; --force means "rebuild and restart what's here", so
    // it presses on with the current checkout.
    if (!force) return false;
    console.log("Pull skipped; rebuilding the current checkout (--force).");
  }
  console.log("Installing dependencies…");
  if ((await run(NPM, ["install"], root)) !== 0) return false;
  console.log("Building…");
  return (await run(NPM, ["run", "build"], root)) === 0;
}

async function npmGlobalUpdate(): Promise<boolean> {
  console.log("Installing the latest release (npm -g)…");
  return (await run(NPM, ["install", "-g", "torlnk@latest"], process.cwd())) === 0;
}

async function restartDaemons(): Promise<void> {
  const running = listRunDescriptors().filter((d) => isAlive(d.pid));
  if (running.length === 0) {
    console.log("No running daemon to restart.");
    return;
  }
  for (const d of running) {
    process.stdout.write(`Restarting ${d.name} daemon (pid ${d.pid})… `);
    const pid = await restartDaemon(d);
    console.log(pid ? `now pid ${pid}.` : "it had already stopped.");
  }
}

export async function runUpdate(opts: { force?: boolean } = {}): Promise<void> {
  console.log(`torlink v${VERSION}`);

  const latest = await fetchLatestVersion();
  if (!opts.force && latest && !isNewer(VERSION, latest)) {
    console.log(`Already on the latest release (v${latest}). Use --force to rebuild and restart anyway.`);
    return;
  }
  console.log(
    opts.force
      ? "Forcing a reinstall and restart…"
      : latest
        ? `Updating to v${latest}…`
        : "Couldn't reach the registry; updating from source anyway…",
  );

  const root = packageRoot();
  const isGitCheckout = fs.existsSync(path.join(root, ".git"));
  const ok = isGitCheckout ? await gitUpdate(root, opts.force ?? false) : await npmGlobalUpdate();

  if (!ok) {
    console.error("Update failed; nothing was restarted.");
    process.exitCode = 1;
    return;
  }

  await restartDaemons();
  console.log("Update complete.");
}
