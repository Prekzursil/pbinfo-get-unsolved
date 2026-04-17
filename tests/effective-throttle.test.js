'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { effectiveDelayMs, effectiveConcurrency } = require('../pbinfo-get-unsolved-enhanced.js');

test('effectiveDelayMs: adaptive wins when enabled and above base', () => {
  assert.equal(effectiveDelayMs({ enabled: true, baseDelayMs: 100, adaptiveDelayMs: 500 }), 500);
});

test('effectiveDelayMs: base wins when adaptive is lower', () => {
  assert.equal(effectiveDelayMs({ enabled: true, baseDelayMs: 300, adaptiveDelayMs: 100 }), 300);
});

test('effectiveDelayMs: disabled returns base', () => {
  assert.equal(effectiveDelayMs({ enabled: false, baseDelayMs: 200, adaptiveDelayMs: 9999 }), 200);
});

test('effectiveDelayMs: non-finite inputs coerce to 0', () => {
  assert.equal(effectiveDelayMs({ enabled: true, baseDelayMs: 'x', adaptiveDelayMs: null }), 0);
});

test('effectiveDelayMs: empty options returns 0', () => {
  assert.equal(effectiveDelayMs(), 0);
});

test('effectiveConcurrency: min(base, adaptive) when enabled', () => {
  assert.equal(
    effectiveConcurrency({ enabled: true, baseConcurrency: 5, adaptiveConcurrency: 2 }),
    2
  );
});

test('effectiveConcurrency: clamp to base when adaptive exceeds it', () => {
  assert.equal(
    effectiveConcurrency({ enabled: true, baseConcurrency: 3, adaptiveConcurrency: 10 }),
    3
  );
});

test('effectiveConcurrency: disabled returns base', () => {
  assert.equal(
    effectiveConcurrency({ enabled: false, baseConcurrency: 5, adaptiveConcurrency: 1 }),
    5
  );
});

test('effectiveConcurrency: non-finite base clamps to 1', () => {
  assert.equal(
    effectiveConcurrency({ enabled: true, baseConcurrency: Number.NaN, adaptiveConcurrency: 4 }),
    1
  );
});

test('effectiveConcurrency: empty options returns 1', () => {
  assert.equal(effectiveConcurrency(), 1);
});
