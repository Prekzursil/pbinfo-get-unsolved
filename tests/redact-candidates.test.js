'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { redactScoreCandidates } = require('../pbinfo-get-unsolved-enhanced.js');

test('redactScoreCandidates: null/non-array returns []', () => {
  assert.deepEqual(redactScoreCandidates(null), []);
  assert.deepEqual(redactScoreCandidates('nope'), []);
  assert.deepEqual(redactScoreCandidates(42), []);
});

test('redactScoreCandidates: truncates tooltip/text and normalizes numbers', () => {
  const out = redactScoreCandidates([
    {
      tooltip: 'x'.repeat(200),
      text: 'y'.repeat(200),
      value: 50,
      max: 100,
      hasRatio: true,
      isLink: false,
    },
  ]);
  assert.equal(out.length, 1);
  assert.ok(out[0].tooltip.length <= 81); // 80 chars + ellipsis
  assert.ok(out[0].text.length <= 81);
  assert.equal(out[0].value, 50);
  assert.equal(out[0].max, 100);
  assert.equal(out[0].hasRatio, true);
  assert.equal(out[0].isLink, false);
});

test('redactScoreCandidates: non-finite numeric fields coerce to null', () => {
  const out = redactScoreCandidates([
    { tooltip: 't', text: 'x', value: Number.NaN, max: 'bad', hasRatio: false, isLink: false },
  ]);
  assert.equal(out[0].value, null);
  assert.equal(out[0].max, null);
});

test('redactScoreCandidates: null entries are passed through safely', () => {
  const out = redactScoreCandidates([null, undefined, {}]);
  assert.equal(out.length, 3);
  assert.equal(out[0].tooltip, '');
  assert.equal(out[0].value, null);
  assert.equal(out[0].isLink, false);
});
