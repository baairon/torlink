'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  semverLt,
  parseVersion,
  countOutdated,
  isDevProject,
  ROOT,
} = require('./ensure.cjs');

describe('ensure', () => {
  it('parseVersion handles semver strings', () => {
    assert.deepEqual(parseVersion('1.3.0'), [1, 3, 0]);
    assert.deepEqual(parseVersion('v22.0.1'), [22, 0, 1]);
    assert.equal(parseVersion('bad'), null);
  });

  it('semverLt compares versions', () => {
    assert.equal(semverLt('1.2.9', '1.3.0'), true);
    assert.equal(semverLt('1.3.0', '1.3.0'), false);
    assert.equal(semverLt('2.0.0', '1.9.9'), false);
  });

  it('countOutdated parses npm outdated json', () => {
    assert.equal(countOutdated(''), 0);
    assert.equal(countOutdated('{"ink":{}}'), 1);
    assert.equal(countOutdated('{}'), 0);
  });

  it('isDevProject detects source tree', () => {
    assert.equal(isDevProject(ROOT), true);
    assert.equal(isDevProject('/tmp'), false);
  });
});
