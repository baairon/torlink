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

// The WebRTC stack (webtorrent -> simple-peer -> webrtc-polyfill) eagerly
// requires node-datachannel's native binary, which only install scripts
// download; npm 12 skips those scripts by default, so the binary is often
// absent and the eager import would kill startup. When it cannot load,
// resolve webrtc-polyfill to an inert stub instead: simple-peer then reports
// WEBRTC_SUPPORT = false and downloads run on TCP/uTP and DHT peers alone.
try {
  require('node-datachannel');
} catch (err) {
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
    process.stderr.write(
      'torlnk: WebRTC peers unavailable (native module not installed); ' +
        'TCP/UDP peers still work. https://github.com/baairon/torlink/issues/60\n'
    );
  } else {
    // Node 22.0 to 22.14 has no module.registerHooks, so the eager import
    // cannot be redirected; a clear explanation beats the raw module error.
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
    process.exit(1);
  }
}

import('./index.js').catch(function (err) {
  process.stderr.write(String((err && err.message) || err) + '\n');
  process.exit(1);
});
