'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveSnapshotLevels } = require('../pbinfo-get-unsolved-enhanced.js');

test('resolveSnapshotLevels: full mode yields the full fallback chain', () => {
  assert.deepEqual(resolveSnapshotLevels('full'), ['full', 'minimal', 'progress']);
});

test('resolveSnapshotLevels: minimal mode skips full', () => {
  assert.deepEqual(resolveSnapshotLevels('minimal'), ['minimal', 'progress']);
});

test('resolveSnapshotLevels: progress mode yields only progress', () => {
  assert.deepEqual(resolveSnapshotLevels('progress'), ['progress']);
});

test('resolveSnapshotLevels: unknown / missing mode coerces to full', () => {
  assert.deepEqual(resolveSnapshotLevels(), ['full', 'minimal', 'progress']);
  assert.deepEqual(resolveSnapshotLevels(null), ['full', 'minimal', 'progress']);
  assert.deepEqual(resolveSnapshotLevels('bogus'), ['full', 'minimal', 'progress']);
});

test('resolveSnapshotLevels: progressOnly=true drops full from the chain', () => {
  assert.deepEqual(resolveSnapshotLevels('full', { progressOnly: true }), ['minimal', 'progress']);
});

test('resolveSnapshotLevels: progressOnly does not affect minimal/progress chains', () => {
  assert.deepEqual(resolveSnapshotLevels('minimal', { progressOnly: true }), [
    'minimal',
    'progress',
  ]);
  assert.deepEqual(resolveSnapshotLevels('progress', { progressOnly: true }), ['progress']);
});
