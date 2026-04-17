'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatRetryDelayLabel,
  parseIdRangeScoreValue,
  idRangeBatchStartForId,
  serializeFilterState,
} = require('../pbinfo-get-unsolved-enhanced.js');

test('formatRetryDelayLabel: sub-second uses 2 decimals, 1s+ uses 1', () => {
  assert.equal(formatRetryDelayLabel(0), '0.00s');
  assert.equal(formatRetryDelayLabel(250), '0.25s');
  assert.equal(formatRetryDelayLabel(999), '1.00s');
  assert.equal(formatRetryDelayLabel(1000), '1.0s');
  assert.equal(formatRetryDelayLabel(12500), '12.5s');
});

test('formatRetryDelayLabel: non-finite inputs coerce to 0', () => {
  assert.equal(formatRetryDelayLabel('x'), '0.00s');
  assert.equal(formatRetryDelayLabel(-500), '0.00s');
  assert.equal(formatRetryDelayLabel(Number.NaN), '0.00s');
});

test('parseIdRangeScoreValue: dash and blank map to null', () => {
  assert.deepEqual(parseIdRangeScoreValue(''), { value: null, raw: '-' });
  assert.deepEqual(parseIdRangeScoreValue('-'), { value: null, raw: '-' });
  assert.deepEqual(parseIdRangeScoreValue('   '), { value: null, raw: '-' });
});

test('parseIdRangeScoreValue: numeric and non-numeric strings', () => {
  assert.deepEqual(parseIdRangeScoreValue('50'), { value: 50, raw: '50' });
  assert.deepEqual(parseIdRangeScoreValue('  42 '), { value: 42, raw: '42' });
  assert.deepEqual(parseIdRangeScoreValue('foo'), { value: null, raw: 'foo' });
});

test('idRangeBatchStartForId: buckets ids into batches of size 200 by default', () => {
  assert.equal(idRangeBatchStartForId(1), 1);
  assert.equal(idRangeBatchStartForId(200), 1);
  assert.equal(idRangeBatchStartForId(201), 201);
  assert.equal(idRangeBatchStartForId(500), 401);
});

test('idRangeBatchStartForId: respects custom startId and batchSize', () => {
  assert.equal(idRangeBatchStartForId(50, { startId: 1, batchSize: 50 }), 1);
  assert.equal(idRangeBatchStartForId(51, { startId: 1, batchSize: 50 }), 51);
  assert.equal(idRangeBatchStartForId(5, { startId: 10, batchSize: 50 }), null);
});

test('idRangeBatchStartForId: rejects bad ids and sizes', () => {
  assert.equal(idRangeBatchStartForId(Number.NaN), null);
  assert.equal(idRangeBatchStartForId(100, { batchSize: 0 }), null);
});

test('idRangeBatchStartForId: non-finite startId / batchSize fall back to defaults', () => {
  // startId non-finite -> defaults to 1.
  assert.equal(idRangeBatchStartForId(200, { startId: Number.NaN, batchSize: 200 }), 1);
  // batchSize non-finite -> defaults to 200.
  assert.equal(idRangeBatchStartForId(200, { startId: 1, batchSize: Number.NaN }), 1);
});

test('parseIdRangeScoreValue: non-string inputs coerce to "-" blank result', () => {
  assert.deepEqual(parseIdRangeScoreValue(null), { value: null, raw: '-' });
  assert.deepEqual(parseIdRangeScoreValue(undefined), { value: null, raw: '-' });
  assert.deepEqual(parseIdRangeScoreValue(42), { value: null, raw: '-' });
  assert.deepEqual(parseIdRangeScoreValue({}), { value: null, raw: '-' });
});

test('serializeFilterState: Set of statuses becomes array; extras clamped', () => {
  const s = serializeFilterState({
    statuses: new Set(['tried', 'unattempted']),
    includeUnknownScore: 'yes',
    scoreMin: 10,
    scoreMax: 'x',
    searchQuery: 'abc',
  });
  assert.deepEqual(s.statuses.sort(), ['tried', 'unattempted']);
  assert.equal(s.includeUnknownScore, true);
  assert.equal(s.scoreMin, 10);
  assert.equal(s.scoreMax, null);
  assert.equal(s.searchQuery, 'abc');
});

test('serializeFilterState: null/non-object input yields safe defaults', () => {
  const s = serializeFilterState(null);
  assert.deepEqual(s, {
    statuses: [],
    includeUnknownScore: false,
    scoreMin: null,
    scoreMax: null,
    searchQuery: '',
  });
});

test('serializeFilterState: array status input is preserved', () => {
  const s = serializeFilterState({ statuses: ['solved'] });
  assert.deepEqual(s.statuses, ['solved']);
});
