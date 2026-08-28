#!/usr/bin/env node
'use strict';

var major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 26) {
  process.stderr.write(
    '\ntorlnk requires Node.js v26 or later.\n' +
    'You are running v' + process.versions.node + '.\n\n' +
    'Upgrade:  https://nodejs.org\n' +
    'With nvm: nvm install 26 && nvm use 26\n\n'
  );
  process.exit(1);
}

// Resolve webrtc-polyfill to an inert stub: simple-peer then reports
// WEBRTC_SUPPORT = false and downloads run on TCP/uTP and DHT peers alone.
// Returns false on Node 22.0 to 22.14, which has no module.registerHooks and
// so cannot redirect the eager import at all.
function useWebrtcStub() {
  var Module = require('node:module');
  if (typeof Module.registerHooks !== 'function') return false;
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
  return true;
}

// The same switch, thrown on purpose. On some machines node-datachannel's
// native event loop burns a core for as long as torlink is open, idle or not
// (issue #119), and nothing inside it can be turned down at runtime. Rather
// than decide for a whole platform, let the person watching their fan spin opt
// out on their own machine: TCP/uTP and DHT peers are where torlink's swarms
// are anyway. Presence is the switch, like TORLINK_NO_UPDATE_CHECK.
if (process.env.TORLINK_NO_WEBRTC || process.env.KLINK_NO_WEBRTC) {
  if (useWebrtcStub()) {
    process.stderr.write('torlnk: WebRTC peers disabled by TORLINK_NO_WEBRTC.\n');
  } else {
    process.stderr.write(
      'torlnk: TORLINK_NO_WEBRTC needs Node 22.15 or later to take effect; ' +
        'WebRTC peers stay enabled on v' + process.versions.node + '.\n'
    );
  }
} else {
  // The WebRTC stack (webtorrent -> simple-peer -> webrtc-polyfill) eagerly
  // requires node-datachannel's native binary, which only install scripts
  // download; npm 12 skips those scripts by default, so the binary is often
  // absent and the eager import would kill startup.
  try {
    require('node-datachannel');
  } catch (err) {
    if (useWebrtcStub()) {
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
}

import('./index.js').catch(function (err) {
  process.stderr.write(String((err && err.message) || err) + '\n');
  process.exit(1);
});
