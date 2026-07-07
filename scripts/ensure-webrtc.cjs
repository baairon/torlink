'use strict';

const { execSync } = require('node:child_process');
const { resolve } = require('node:path');

// During postinstall the CWD is always torlink's root directory.
// Check whether the native module actually loads; if prebuild-install
// succeeded on its own (Node 18/20) there is nothing to do.

try {
  require('node-datachannel');
  process.exit(0);
} catch {
  // Not built — rebuild from source.
}

console.error('\ntorlnk: building WebRTC native module from source.\n');

try {
  execSync('npx --yes cmake-js build', {
    cwd: resolve('node_modules', 'node-datachannel'),
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
    timeout: 300000,
  });
} catch {
  console.error('');
  console.error('torlnk: could not build WebRTC native module.');
  console.error('Install cmake and a C++ compiler, then run again:');
  console.error('  Fedora:  sudo dnf install cmake gcc-c++');
  console.error('  Debian / Ubuntu:  sudo apt install cmake g++');
  console.error('  macOS:   xcode-select --install');
  console.error('  Windows: install CMake and Visual Studio Build Tools');
  console.error('');
  console.error('https://github.com/baairon/torlink/issues/60');
  process.exit(1);
}
