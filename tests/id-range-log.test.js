'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { formatIdRangeProgressLog } = require('../pbinfo-get-unsolved-enhanced.js');

test('formatIdRangeProgressLog: baseline format', () => {
  const out = formatIdRangeProgressLog(100, {
    pages: 50,
    total: 40,
    missing: 2,
    forbidden: 0,
  });
  assert.ok(out.includes('ID 100: progres'));
  assert.ok(out.includes('50 scanate'));
  assert.ok(out.includes('găsite 40'));
  assert.ok(out.includes('404 2'));
  assert.ok(!out.includes('403'));
});

test('formatIdRangeProgressLog: adds forbidden suffix only when > 0', () => {
  const out = formatIdRangeProgressLog(5, {
    pages: 1,
    total: 0,
    missing: 0,
    forbidden: 3,
  });
  assert.ok(out.includes('403 3'));
});

test('formatIdRangeProgressLog: non-finite stats coerce to 0', () => {
  const out = formatIdRangeProgressLog(1, {});
  assert.ok(out.includes('0 scanate'));
  assert.ok(out.includes('găsite 0'));
  assert.ok(out.includes('404 0'));
});
