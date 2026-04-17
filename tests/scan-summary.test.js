'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeScanSummary } = require('../pbinfo-get-unsolved-enhanced.js');

test('computeScanSummary: counts shown, total, unsolved correctly', () => {
  const all = [
    { status: 'solved' },
    { status: 'tried' },
    { status: 'tried' },
    { status: 'unattempted' },
  ];
  const visible = all.slice(1);
  const s = computeScanSummary(visible, all, { scanMode: 'list', pages: 3 });
  assert.equal(s.shown, 3);
  assert.equal(s.total, 4);
  assert.equal(s.unsolved, 3);
  assert.equal(s.unitLabel, 'pagini');
  assert.equal(s.pages, 3);
  assert.ok(s.summaryText.includes('scanate=4'));
  assert.ok(s.summaryText.includes('nerezolvate=3'));
  assert.ok(s.summaryText.includes('afișate=3'));
  assert.ok(s.summaryText.includes('pagini=3'));
});

test('computeScanSummary: id-range mode uses ID-uri unit', () => {
  const s = computeScanSummary([], [], { scanMode: 'id-range', pages: 10 });
  assert.equal(s.unitLabel, 'ID-uri');
  assert.ok(s.summaryText.includes('ID-uri=10'));
});

test('computeScanSummary: defaults when options omitted', () => {
  const s = computeScanSummary([], []);
  assert.equal(s.unitLabel, 'pagini');
  assert.equal(s.pages, 0);
  assert.ok(s.summaryText.includes('pagini=0'));
});

test('computeScanSummary: non-array inputs coerce to empty', () => {
  const s = computeScanSummary(null, null, { scanMode: 'list' });
  assert.equal(s.shown, 0);
  assert.equal(s.total, 0);
  assert.equal(s.unsolved, 0);
});

test('computeScanSummary: non-finite pages coerces to 0', () => {
  const s = computeScanSummary([], [], { scanMode: 'list', pages: Number.NaN });
  assert.equal(s.pages, 0);
});

test('computeScanSummary: entry without status counts as unsolved', () => {
  const all = [{ status: 'solved' }, {}];
  const s = computeScanSummary(all, all);
  assert.equal(s.unsolved, 1);
});
