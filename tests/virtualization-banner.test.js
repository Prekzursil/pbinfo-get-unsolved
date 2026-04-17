'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { formatVirtualizationBanner } = require('../pbinfo-get-unsolved-enhanced.js');

test('formatVirtualizationBanner: renders shown/total counts in message', () => {
  const msg = formatVirtualizationBanner(100, 500);
  assert.ok(msg.includes('primele 100'));
  assert.ok(msg.includes('din 500'));
});

test('formatVirtualizationBanner: zero shown still renders', () => {
  const msg = formatVirtualizationBanner(0, 10);
  assert.ok(msg.includes('primele 0'));
});
