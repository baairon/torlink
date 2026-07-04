'use strict';

const { chmodSync, copyFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const src = resolve(root, 'scripts/cli-entry.cjs');
const dest = resolve(root, 'dist/cli.cjs');

copyFileSync(src, dest);

// On Windows chmod is effectively a no-op, and npm re-applies bin permissions on install anyway, so a failure
// here shouldn't fail the build, but warn rather than swallow the error.
try {
  chmodSync(dest, 0o755);
} catch (err) {
  console.warn('postbuild: could not set executable bit on dist/cli.cjs:', err.message);
}

console.log('postbuild: wrote dist/cli.cjs');
