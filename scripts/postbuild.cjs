'use strict';

const { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const src = resolve(root, 'scripts/cli-entry.cjs');
const dest = resolve(root, 'dist/cli.cjs');
const ensureSrc = resolve(root, 'scripts/ensure.cjs');
const ensureDest = resolve(root, 'dist/ensure.cjs');
const webSrc = resolve(root, 'web');
const webDest = resolve(root, 'dist/web');

copyFileSync(src, dest);
copyFileSync(ensureSrc, ensureDest);

if (existsSync(webSrc)) {
  mkdirSync(resolve(root, 'dist'), { recursive: true });
  cpSync(webSrc, webDest, { recursive: true });
  console.log('postbuild: copied web/ → dist/web/');
}

// On Windows chmod is effectively a no-op, and npm re-applies bin permissions on install anyway, so a failure
// here shouldn't fail the build, but warn rather than swallow the error.
try {
  chmodSync(dest, 0o755);
} catch (err) {
  console.warn('postbuild: could not set executable bit on dist/cli.cjs:', err.message);
}

console.log('postbuild: wrote dist/cli.cjs and dist/ensure.cjs');
