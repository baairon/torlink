#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');

const ROOT = resolve(__dirname, '..');

function parseArgs(argv) {
  return {
    dev: argv.includes('--dev'),
    quiet: argv.includes('--quiet'),
    prod: argv.includes('--prod'),
  };
}

function log(msg, quiet) {
  if (!quiet) process.stderr.write(`${msg}\n`);
}

function shouldSkip() {
  return (
    process.env.TORLNK_SKIP_UPDATE === '1' ||
    process.env.CI === 'true' ||
    process.env.CI === '1'
  );
}

function checkNode() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 22) {
    process.stderr.write(
      '\ntorlnk requires Node.js v22 or later.\n' +
        `You are running v${process.versions.node}.\n\n` +
        'Upgrade:  https://nodejs.org\n' +
        'With nvm: nvm install 22 && nvm use 22\n\n'
    );
    process.exit(1);
  }
}

function readPkg(root) {
  return JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
}

function npmCmd() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runNpm(args, opts = {}) {
  return spawnSync(npmCmd(), args, {
    cwd: opts.cwd || ROOT,
    stdio: opts.stdio || 'pipe',
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32',
  });
}

function parseVersion(v) {
  const m = String(v)
    .trim()
    .replace(/^v/, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function semverLt(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return false;
  for (let i = 0; i < 3; i++) {
    if (va[i] < vb[i]) return true;
    if (va[i] > vb[i]) return false;
  }
  return false;
}

function getLatestNpmVersion(pkgName) {
  const result = runNpm(['view', pkgName, 'version', '--json']);
  if (result.status !== 0 || !result.stdout) return null;
  try {
    const parsed = JSON.parse(result.stdout.trim());
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return result.stdout.trim().replace(/^"|"$/g, '') || null;
  }
}

function countOutdated(stdout) {
  if (!stdout) return 0;
  try {
    return Object.keys(JSON.parse(stdout)).length;
  } catch {
    return 0;
  }
}

function isDevProject(root) {
  return existsSync(resolve(root, 'src')) && existsSync(resolve(root, 'package.json'));
}

function ensureNodeModules(root, quiet) {
  if (existsSync(resolve(root, 'node_modules'))) return;

  log('torlnk: installing dependencies…', quiet);
  const install = runNpm(['install'], { cwd: root, stdio: 'inherit' });
  if (install.status !== 0) {
    process.stderr.write('torlnk: npm install failed.\n');
    process.exit(install.status || 1);
  }
}

function updateDependencies(root, quiet, includeDev) {
  ensureNodeModules(root, quiet);

  const outdated = runNpm(['outdated', '--json'], { cwd: root });
  const count = countOutdated(outdated.stdout);
  if (count === 0) return;

  log(`torlnk: updating ${count} package(s)…`, quiet);
  const args = includeDev ? ['update'] : ['update', '--omit=dev'];
  const update = runNpm(args, { cwd: root, stdio: 'inherit' });
  if (update.status !== 0) {
    log('torlnk: npm update had issues; continuing anyway.', quiet);
  }
}

function updateSelf(pkg, quiet) {
  const latest = getLatestNpmVersion(pkg.name);
  if (!latest || !semverLt(pkg.version, latest)) return false;

  log(`torlnk: ${pkg.version} → ${latest}, updating…`, quiet);
  const globalUpdate = runNpm(['install', '-g', `${pkg.name}@latest`], { stdio: 'inherit' });
  if (globalUpdate.status === 0) {
    log('torlnk: updated. Restart torlnk to use the new version.', quiet);
    return true;
  }

  const localUpdate = runNpm(['install', `${pkg.name}@latest`], { cwd: ROOT, stdio: 'inherit' });
  if (localUpdate.status === 0) {
    log('torlnk: updated local install.', quiet);
    return true;
  }

  log(`torlnk: update available (${latest}) but auto-update failed. Run: npm install -g ${pkg.name}@latest`, quiet);
  return false;
}

function run(opts = {}) {
  checkNode();
  if (shouldSkip()) return { updated: false };

  const root = opts.root || ROOT;
  const quiet = Boolean(opts.quiet);
  const dev = Boolean(opts.dev) || (!opts.prod && isDevProject(root));
  const pkg = readPkg(root);

  if (dev) {
    updateDependencies(root, quiet, true);
    return { updated: false };
  }

  const updated = updateSelf(pkg, quiet);
  updateDependencies(root, quiet, false);
  return { updated };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  run({ dev: args.dev, quiet: args.quiet, prod: args.prod });
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${String(err?.message || err)}\n`);
    process.exit(1);
  });
}

module.exports = {
  checkNode,
  semverLt,
  parseVersion,
  parseArgs,
  countOutdated,
  isDevProject,
  run,
  ROOT,
};
