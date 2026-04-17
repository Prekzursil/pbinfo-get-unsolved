'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  safeJsonParse,
  fnv1a32,
  classifyStorageError,
  formatDateTime,
  formatDuration,
  normalizeScanMode,
  parseIdRangeInput,
  normalizeSnapshotIndex,
  buildStateKeys,
} = require('../pbinfo-get-unsolved-enhanced.js');

test('safeJsonParse: parses valid JSON and rejects invalid shapes', () => {
  assert.deepEqual(safeJsonParse('{"a":1}'), { a: 1 });
  assert.equal(safeJsonParse(null), null);
  assert.equal(safeJsonParse(''), null);
  assert.equal(safeJsonParse('   '), null);
  assert.equal(safeJsonParse('{not json'), null);
  assert.equal(safeJsonParse(42), null);
});

test('fnv1a32: stable hash, null-safe, 8-hex output', () => {
  const h1 = fnv1a32('https://www.pbinfo.ro/?pagina=probleme-lista');
  const h2 = fnv1a32('https://www.pbinfo.ro/?pagina=probleme-lista');
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{8}$/);
  assert.notEqual(h1, fnv1a32('different'));
  assert.equal(fnv1a32(null), fnv1a32(''));
  assert.match(fnv1a32(undefined), /^[0-9a-f]{8}$/);
});

test('classifyStorageError: maps quota-ish errors to "quota"', () => {
  assert.equal(classifyStorageError(null), 'unknown');
  assert.equal(classifyStorageError(undefined), 'unknown');
  assert.equal(classifyStorageError({ name: 'QuotaExceededError' }), 'quota');
  assert.equal(classifyStorageError({ code: 22 }), 'quota');
  assert.equal(classifyStorageError({ code: 1014 }), 'quota');
  assert.equal(classifyStorageError({ name: 'SomethingElse', code: 99 }), 'unknown');
});

test('formatDateTime: returns "-" for non-finite, locale string for valid', () => {
  assert.equal(formatDateTime(NaN), '-');
  assert.equal(formatDateTime('not a number'), '-');
  const now = Date.now();
  const s = formatDateTime(now);
  assert.notEqual(s, '-');
  assert.equal(typeof s, 'string');
});

test('formatDuration: seconds / minutes / hours formatting', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(999), '0s');
  assert.equal(formatDuration(1000), '1s');
  assert.equal(formatDuration(65 * 1000), '1m 05s');
  assert.equal(formatDuration(3600 * 1000), '1h 00m 00s');
  assert.equal(formatDuration((3600 + 125) * 1000), '1h 02m 05s');
  // Negative duration clamps to 0s.
  assert.equal(formatDuration(-1000), '0s');
});

test('normalizeScanMode: numeric, token, and fuzzy inputs', () => {
  assert.equal(normalizeScanMode('1'), 'list');
  assert.equal(normalizeScanMode('2'), 'id-range');
  assert.equal(normalizeScanMode('  list  '), 'list');
  assert.equal(normalizeScanMode('ID RANGE'), 'id-range');
  assert.equal(normalizeScanMode('range'), 'id-range');
  assert.equal(normalizeScanMode('by index'), 'id-range');
  assert.equal(normalizeScanMode(''), null);
  assert.equal(normalizeScanMode('bogus'), null);
  assert.equal(normalizeScanMode(null), null);
});

test('parseIdRangeInput: single number, range, fallback, rejects invalid', () => {
  assert.deepEqual(parseIdRangeInput('1-8000', ''), { startId: 1, endId: 8000 });
  assert.deepEqual(parseIdRangeInput('500'), { startId: 1, endId: 500 });
  assert.deepEqual(parseIdRangeInput('', '200'), { startId: 1, endId: 200 });
  assert.equal(parseIdRangeInput(null, null), null);
  assert.equal(parseIdRangeInput('0-10'), null);
  assert.equal(parseIdRangeInput('not a number', ''), null);
});

test('normalizeSnapshotIndex: filters unnamed entries, sorts by savedAt desc', () => {
  const out = normalizeSnapshotIndex([
    { id: 'a', savedAt: 1000, storageLevel: 'progress', label: 'older' },
    { id: '', savedAt: 9999, storageLevel: 'minimal' }, // dropped
    { id: 'b', savedAt: 3000, storageLevel: 'bogus', storageVersion: 1 },
    { id: 'c', savedAt: 'not-a-number', storageLevel: 'minimal', storageVersion: 99 },
  ]);
  assert.equal(out.length, 3);
  assert.equal(out[0].id, 'b');
  assert.equal(
    out[0].storageLevel,
    'bogus' === out[0].storageLevel ? out[0].storageLevel : 'minimal'
  );
  // 'bogus' is rewritten to 'minimal' because it's not in the allowed set.
  assert.equal(out[0].storageLevel, 'minimal');
  assert.equal(out[0].storageVersion, 1);
  // 'c' has non-finite savedAt -> null -> sorts last
  assert.equal(out[out.length - 1].id, 'c');
  assert.equal(out[out.length - 1].savedAt, null);
  assert.equal(out[out.length - 1].storageVersion, 2);
});

test('normalizeSnapshotIndex: non-array input returns []', () => {
  assert.deepEqual(normalizeSnapshotIndex(null), []);
  assert.deepEqual(normalizeSnapshotIndex({}), []);
});

test('normalizeSnapshotIndex: respects custom version pair', () => {
  const out = normalizeSnapshotIndex([{ id: 'x', savedAt: 1, storageVersion: 5 }], {
    storageVersion: 6,
    legacyVersion: 5,
  });
  assert.equal(out[0].storageVersion, 5);
});

test('buildStateKeys: deterministic and namespaced', () => {
  const keys = buildStateKeys('https://www.pbinfo.ro/?pagina=probleme-lista');
  assert.match(keys.full, /^pbinfo-get-unsolved:state:v2:[0-9a-f]{8}$/);
  assert.match(keys.minimal, /^pbinfo-get-unsolved:state-min:v2:[0-9a-f]{8}$/);
  assert.match(keys.index, /^pbinfo-get-unsolved:state-index:v2:[0-9a-f]{8}$/);
  assert.match(keys.itemPrefix, /^pbinfo-get-unsolved:state-item:v2:[0-9a-f]{8}:$/);

  const keys2 = buildStateKeys('https://www.pbinfo.ro/?pagina=probleme-lista');
  assert.deepEqual(keys, keys2);

  const v1 = buildStateKeys('x', { version: 1 });
  assert.ok(v1.full.includes(':v1:'));

  const ns = buildStateKeys('x', { namespace: 'alt-ns' });
  assert.ok(ns.full.startsWith('alt-ns:'));
});
