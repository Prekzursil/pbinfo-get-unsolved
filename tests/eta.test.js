'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeEta } = require('../pbinfo-get-unsolved-enhanced.js');

test('computeEta: linear extrapolation', () => {
  // 10 done in 1000ms means 1 per 100ms → 40 remaining → 4000ms
  assert.equal(computeEta(10, 50, 1000), 4000);
});

test('computeEta: total null / 0 returns null', () => {
  assert.equal(computeEta(5, null, 1000), null);
  assert.equal(computeEta(5, 0, 1000), null);
});

test('computeEta: done=0 returns null (cannot extrapolate)', () => {
  assert.equal(computeEta(0, 10, 1000), null);
});

test('computeEta: elapsed=0 returns null', () => {
  assert.equal(computeEta(5, 10, 0), null);
});

test('computeEta: done >= total returns 0', () => {
  assert.equal(computeEta(10, 10, 1000), 0);
  assert.equal(computeEta(99, 10, 1000), 0);
});

test('computeEta: non-finite inputs coerce to 0/null', () => {
  assert.equal(computeEta(Number.NaN, 10, 1000), null);
  assert.equal(computeEta(5, Number.NaN, 1000), null);
  assert.equal(computeEta(5, 10, Number.NaN), null);
});

test('computeEta: negative done clamps to 0', () => {
  assert.equal(computeEta(-5, 10, 1000), null);
});
