#!/usr/bin/env node
'use strict';

var major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 22) {
  process.stderr.write(
    '\ntorlnk requires Node.js v22 or later.\n' +
    'You are running v' + process.versions.node + '.\n\n' +
    'Upgrade:  https://nodejs.org\n' +
    'With nvm: nvm install 22 && nvm use 22\n\n'
  );
  process.exit(1);
}

// WebRTC on macOS causes high/100% CPU usage even when idle due to issues in node-datachannel / libdatachannel.
// Since TCP/UDP/DHT peers are sufficient, we completely disable WebRTC on macOS by forcing the stub resolver.
var isDarwin = process.platform === 'darwin';
var hasDatachannel = false;

if (!isDarwin) {
  try {
    require('node-datachannel');
    hasDatachannel = true;
  } catch (err) {
    // Keep hasDatachannel false
  }
}

if (!hasDatachannel) {
  var Module = require('node:module');
  if (typeof Module.registerHooks === 'function') {
    var stubUrl = require('node:url')
      .pathToFileURL(require('node:path').join(__dirname, 'webrtc-stub.mjs'))
      .href;
    Module.registerHooks({
      resolve: function (specifier, context, nextResolve) {
        if (specifier === 'webrtc-polyfill') {
          return { url: stubUrl, shortCircuit: true };
        }
        return nextResolve(specifier, context);
      },
    });
    if (isDarwin) {
      process.stderr.write(
        'torlnk: WebRTC peers disabled on macOS to prevent high CPU usage/crashes; ' +
          'TCP/UDP peers still work. https://github.com/baairon/torlink/issues/119\n'
      );
    } else {
      process.stderr.write(
        'torlnk: WebRTC peers unavailable (native module not installed); ' +
          'TCP/UDP peers still work. https://github.com/baairon/torlink/issues/60\n'
      );
    }
  } else {
    // Node 22.0 to 22.14 has no module.registerHooks, so the eager import
    // cannot be redirected; a clear explanation beats the raw module error.
    if (isDarwin) {
      process.stderr.write(
        '\ntorlnk requires disabling WebRTC on macOS to prevent high CPU usage, which\n' +
          'requires Node 22.15+ (to allow module redirection stubs).\n' +
          'Please upgrade Node.js to Node 22.15+ or later.\n\n'
      );
    } else {
      process.stderr.write(
        '\ntorlnk needs the WebRTC native module (node-datachannel), and it is\n' +
          'not installed. Either upgrade to Node 22.15+ (torlnk then runs\n' +
          'without WebRTC peers), or install the build tools and reinstall:\n' +
          '  Fedora:  sudo dnf install cmake gcc-c++ openssl-devel libstdc++-static\n' +
          '  Debian / Ubuntu:  sudo apt install cmake g++ libssl-dev\n' +
          '  macOS:   xcode-select --install\n' +
          '  Windows: install CMake and Visual Studio Build Tools\n' +
          'On npm 12, also allow install scripts: npm approve-scripts\n\n' +
          'https://github.com/baairon/torlink/issues/60\n\n'
      );
    }
    process.exit(1);
  }
}

import('./index.js').catch(function (err) {
  process.stderr.write(String((err && err.message) || err) + '\n');
  process.exit(1);
});
