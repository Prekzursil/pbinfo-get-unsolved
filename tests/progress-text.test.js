'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { formatProgressText } = require('../pbinfo-get-unsolved-enhanced.js');

test('formatProgressText: list mode basic output', () => {
  const out = formatProgressText({
    scanMode: 'list',
    stats: { pages: 3, total: 15 },
    elapsedMs: 5000,
  });
  assert.ok(out.includes('Progres: pagini 3'));
  assert.ok(out.includes('probleme 15'));
  assert.ok(out.includes('timp 5s'));
});

test('formatProgressText: list mode with totalPages and pageSize', () => {
  const out = formatProgressText({
    scanMode: 'list',
    stats: { pages: 2, total: 20 },
    totalPages: 10,
    totalProblems: 100,
    pageSize: 10,
    scanStart: 1,
    elapsedMs: 1000,
  });
  assert.ok(out.includes('pagini 2/10'));
  assert.ok(out.includes('probleme 20/100'));
});

test('formatProgressText: id-range mode', () => {
  const out = formatProgressText({
    scanMode: 'id-range',
    stats: { pages: 5, total: 4, missing: 1, forbidden: 0 },
    config: { idRange: { endId: 10 } },
    scanStart: 1,
    elapsedMs: 1000,
  });
  assert.ok(out.includes('ID-uri 5/10'));
  assert.ok(out.includes('probleme 4 (găsite)'));
  assert.ok(out.includes('404 1'));
});

test('formatProgressText: id-range with forbidden counts', () => {
  const out = formatProgressText({
    scanMode: 'id-range',
    stats: { pages: 3, total: 2, missing: 0, forbidden: 1 },
    config: { idRange: { endId: 3 } },
    scanStart: 1,
    elapsedMs: 1000,
  });
  assert.ok(out.includes('403 1'));
});

test('formatProgressText: paused + inFlight + start > 1 + adaptive injected', () => {
  const out = formatProgressText({
    scanMode: 'list',
    stats: { pages: 1, total: 0 },
    scanStart: 3,
    elapsedMs: 500,
    inFlight: 2,
    paused: true,
    adaptive: { enabled: true, delayMs: 250, concurrency: 1 },
  });
  assert.ok(out.includes('pauză'));
  assert.ok(out.includes('în lucru 2'));
  assert.ok(out.includes('(de la 3)'));
  assert.ok(out.includes('throttle delay=250ms'));
});

test('formatProgressText: ETA omitted when total unknown', () => {
  const out = formatProgressText({
    scanMode: 'list',
    stats: { pages: 2, total: 5 },
    elapsedMs: 1000,
  });
  assert.ok(!out.includes('ETA'));
});

test('formatProgressText: ETA present when total known and progress non-zero', () => {
  const out = formatProgressText({
    scanMode: 'list',
    stats: { pages: 2, total: 5 },
    totalPages: 10,
    elapsedMs: 1000,
  });
  assert.ok(out.includes('ETA'));
});

test('formatProgressText: id-range without endId keeps raw done count', () => {
  const out = formatProgressText({
    scanMode: 'id-range',
    stats: { pages: 7, total: 0, missing: 0, forbidden: 0 },
    config: {},
    elapsedMs: 1000,
  });
  assert.ok(out.includes('ID-uri 7'));
  assert.ok(!out.includes('/'));
});

test('formatProgressText: list mode with totalProblems but no pageSize hits else-if branch', () => {
  // scanProblemsTotal is null when pageSize is NaN, but totalProblems is finite
  // -> else-if branch prints "totalCount/totalProblems" (L909-910).
  const out = formatProgressText({
    scanMode: 'list',
    stats: { pages: 1, total: 7 },
    totalProblems: 50,
    pageSize: Number.NaN,
    scanStart: 1,
    elapsedMs: 1000,
  });
  assert.ok(out.includes('probleme 7/50'));
});
