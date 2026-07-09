'use strict';

const { execSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

// During postinstall the CWD is always torlink's root directory.
// Check whether the native module actually loads; if prebuild-install
// succeeded on its own (Node 18/20) there is nothing to do.

const moduleDir = resolve('node_modules', 'node-datachannel');
if (!existsSync(moduleDir)) {
  process.exit(0); // nothing installed, nothing to build
}

try {
  require('node-datachannel');
  process.exit(0);
} catch {
  // Not built - rebuild from source.
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
  console.error('To enable them, install cmake and a C++ compiler, then reinstall:');
  console.error('  Fedora:  sudo dnf install cmake gcc-c++');
  console.error('  Debian / Ubuntu:  sudo apt install cmake g++');
  console.error('  macOS:   xcode-select --install');
  console.error('  Windows: install CMake and Visual Studio Build Tools');
  console.error('');
  console.error('https://github.com/baairon/torlink/issues/60');
}
process.exit(0);
