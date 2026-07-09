#!/usr/bin/env node
'use strict';

var path = require('node:path');
var fs = require('node:fs');

var ensurePath = path.join(__dirname, 'ensure.cjs');
if (!fs.existsSync(ensurePath)) {
  ensurePath = path.join(__dirname, '..', 'scripts', 'ensure.cjs');
}
if (fs.existsSync(ensurePath)) {
  require(ensurePath).run({ prod: true, root: path.join(__dirname, '..') });
}

import('./index.js').catch(function (err) {
  process.stderr.write(String((err && err.message) || err) + '\n');
  process.exit(1);
});
