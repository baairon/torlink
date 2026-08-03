// `torlnk update`: fetch the latest release, apply it, and bring any --daemon
// process back on the new code. Two install shapes are handled: a git checkout
// (pull, install, build) and a global npm install (npm i -g), chosen by whether
// the package root is a git working tree. The package name and root come from
// the manifest at runtime, never a hardcoded slug.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { VERSION } from "../version";
import { fetchLatestVersion, isNewer } from "./version";
import { readManifest } from "./manifest";
import { isAlive, listRunDescriptors, restartDaemon } from "../daemon/restart";

// git is a real binary everywhere and spawns without a shell, so paths with
// spaces survive as plain argv entries. npm is npm.cmd on Windows and a .cmd
// needs a shell there; every npm invocation below has space-free args, which
// keeps that shell safe without hand-quoting.
const IS_WIN = process.platform === "win32";
const NPM = IS_WIN ? "npm.cmd" : "npm";

function run(cmd: string, args: string[], cwd: string, useShell = false): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit", shell: useShell });
    child.on("error", () => resolve(-1)); // e.g. command not found
    child.on("exit", (code) => resolve(code ?? -1));
  });
}

// A root the current user cannot write to belongs to a package manager (the
// nix store is the concrete case today). Updating through npm would fail on
// the read-only prefix or shadow the managed binary, so name the situation and
// stop instead. Returns who owns the install, or null when it is ours to touch.
export function managedInstallOwner(
  root: string,
  accessImpl: (p: string) => void = (p) => fs.accessSync(p, fs.constants.W_OK),
): string | null {
  if (/^\/nix\/store\//.test(root.replace(/\\/g, "/"))) return "nix";
  try {
    accessImpl(root);
  } catch {
    return "your package manager";
  }
  return null;
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
  if ((await run(NPM, ["install"], root, IS_WIN)) !== 0) return false;
  console.log("Building…");
  return (await run(NPM, ["run", "build"], root, IS_WIN)) === 0;
}

async function npmGlobalUpdate(name: string): Promise<boolean> {
  console.log("Installing the latest release (npm -g)…");
  return (await run(NPM, ["install", "-g", `${name}@latest`], process.cwd(), IS_WIN)) === 0;
}

async function restartDaemons(): Promise<void> {
  const running = listRunDescriptors().filter((d) => isAlive(d.pid));
  if (running.length === 0) {
    console.log("No running daemon to restart.");
    return;
  }
  for (const d of running) {
    process.stdout.write(`Restarting ${d.name} daemon (pid ${d.pid})… `);
    const res = await restartDaemon(d);
    console.log(
      res.stillRunning
        ? "still shutting down; skipped (stop it, then rerun torlnk update --force)."
        : res.newPid
          ? `now pid ${res.newPid}.`
          : "it had already stopped.",
    );
  }
}

export async function runUpdate(opts: { force?: boolean } = {}): Promise<void> {
  console.log(`torlink v${VERSION}`);

  const manifest = readManifest();
  if (!manifest) {
    console.error("Couldn't locate the package manifest; nothing was updated.");
    process.exitCode = 1;
    return;
  }

  const latest = await fetchLatestVersion({ packageName: manifest.name });
  if (!opts.force && latest && !isNewer(VERSION, latest)) {
    console.log(`Already on the latest release (v${latest}). Use --force to rebuild and restart anyway.`);
    return;
  }

  const root = manifest.root;
  const isGitCheckout = fs.existsSync(path.join(root, ".git"));
  if (!isGitCheckout) {
    const owner = managedInstallOwner(root);
    if (owner) {
      console.log(`This install is managed by ${owner}; update it there.`);
      return;
    }
  }

  console.log(
    opts.force
      ? "Forcing a reinstall and restart…"
      : latest
        ? `Updating to v${latest}…`
        : "Couldn't reach the registry; updating from source anyway…",
  );

  const ok = isGitCheckout ? await gitUpdate(root, opts.force ?? false) : await npmGlobalUpdate(manifest.name);

  if (!ok) {
    console.error("Update failed; nothing was restarted.");
    process.exitCode = 1;
    return;
  }

  await restartDaemons();
  console.log("Update complete.");
}
