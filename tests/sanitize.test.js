'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeForDebugLog } = require('../pbinfo-get-unsolved-enhanced.js');

test('sanitizeForDebugLog: null / undefined → empty string', () => {
  assert.equal(sanitizeForDebugLog(null), '');
  assert.equal(sanitizeForDebugLog(undefined), '');
});

test('sanitizeForDebugLog: coerces non-strings via String()', () => {
  assert.equal(sanitizeForDebugLog(42), '42');
  assert.equal(sanitizeForDebugLog(true), 'true');
});

test('sanitizeForDebugLog: strips C0 and DEL control chars', () => {
  const dirty = 'a\u0000b\u0007c\u001bd\u007fe';
  assert.equal(sanitizeForDebugLog(dirty), 'a b c d e');
});

test('sanitizeForDebugLog: preserves non-control printable characters and unicode', () => {
  assert.equal(sanitizeForDebugLog('Șir de caractere'), 'Șir de caractere');
});

test('sanitizeForDebugLog: caps length and appends an ellipsis when truncating', () => {
  const long = 'x'.repeat(500);
  const clipped = sanitizeForDebugLog(long, 50);
  assert.equal(clipped.length, 51); // 50 chars + ellipsis
  assert.ok(clipped.endsWith('…'));
});

test('sanitizeForDebugLog: non-positive maxLength uses the default cap', () => {
  const long = 'y'.repeat(500);
  const clipped = sanitizeForDebugLog(long, 0);
  assert.equal(clipped.length, 201); // default cap is 200
});

test('sanitizeForDebugLog: under-cap strings pass through unchanged', () => {
  assert.equal(sanitizeForDebugLog('short', 100), 'short');
});
