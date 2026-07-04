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

import('./index.js').catch(function (err) {
  process.stderr.write(String((err && err.message) || err) + '\n');
  process.exit(1);
});
