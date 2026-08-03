'use strict';

const { execSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

// During postinstall the CWD is always torlink's root directory.
// Check whether the native module actually loads; if prebuild-install
// succeeded on its own (Node 18/20) there is nothing to do. require()
// resolves through any node_modules layout, so this check is layout-proof.

try {
  require('node-datachannel');
  process.exit(0);
} catch {
  // Missing or not built - locate it and rebuild from source.
}

// npm nests the module under our own node_modules for local dev and npm -g,
// but hoists it beside us for npx and project installs. Check both layouts
// (CWD is the package root, so our parent directory is that node_modules).
const candidates = [
  resolve('node_modules', 'node-datachannel'),
  resolve('..', 'node-datachannel'),
];
const moduleDir = candidates.find((dir) => existsSync(dir));
if (!moduleDir) {
  process.exit(0); // nothing installed, nothing to build
}

console.error('\ntorlnk: building WebRTC native module from source.\n');

try {
  execSync('npx --yes cmake-js build', {
    cwd: moduleDir,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
    timeout: 300000,
  });
} catch {
  // Warn but never fail the install: torlink works without WebRTC peers
  // (TCP/uTP swarms still connect), so a missing toolchain must not brick
  // `npm install`.
  console.error('');
  console.error('torlnk: could not build the WebRTC native module.');
  console.error('torlnk still works; WebRTC peers just stay unavailable.');
  console.error('To enable them, install the build tools, then reinstall:');
  console.error('  Fedora:  sudo dnf install cmake gcc-c++ openssl-devel libstdc++-static');
  console.error('  Debian / Ubuntu:  sudo apt install cmake g++ libssl-dev');
  console.error('  macOS:   xcode-select --install');
  console.error('  Windows: install CMake and Visual Studio Build Tools');
  console.error('');
  console.error('https://github.com/baairon/torlink/issues/60');
}
process.exit(0);
