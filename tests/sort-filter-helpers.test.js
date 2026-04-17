'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  quicksortByKey,
  quicksortPartition,
  toggleSortedState,
  filterProblems,
} = require('../pbinfo-get-unsolved-enhanced.js');

test('quicksortByKey: sorts objects by numeric key ascending, returns the same array', () => {
  const data = [{ v: 3 }, { v: 1 }, { v: 4 }, { v: 1 }, { v: 5 }, { v: 9 }, { v: 2 }, { v: 6 }];
  const sorted = quicksortByKey(data, 'v');
  assert.strictEqual(sorted, data);
  assert.deepEqual(
    sorted.map((x) => x.v),
    [1, 1, 2, 3, 4, 5, 6, 9]
  );
});

test('quicksortByKey: empty + single-element arrays are no-ops', () => {
  assert.deepEqual(quicksortByKey([], 'v'), []);
  const one = [{ v: 42 }];
  assert.deepEqual(quicksortByKey(one, 'v'), [{ v: 42 }]);
});

test('quicksortPartition: partition index separates smaller vs larger elements', () => {
  const arr = [{ k: 5 }, { k: 1 }, { k: 9 }, { k: 2 }];
  const idx = quicksortPartition(arr, 0, arr.length - 1, 'k');
  for (let i = 0; i < idx; i++) assert.ok(arr[i].k <= arr[idx].k);
});

test('toggleSortedState: first tap sets ascending (1), further taps flip sign', () => {
  const sorted = { cnt: 0, id: 0 };
  toggleSortedState(sorted, 'id');
  assert.equal(sorted.id, 1);
  assert.equal(sorted.cnt, 0);
  toggleSortedState(sorted, 'id');
  assert.equal(sorted.id, -1);
  toggleSortedState(sorted, 'id');
  assert.equal(sorted.id, 1);
});

test('toggleSortedState: tapping a new column resets the old one', () => {
  const sorted = { cnt: 1, id: 0, score: 0 };
  toggleSortedState(sorted, 'score');
  assert.equal(sorted.cnt, 0);
  assert.equal(sorted.id, 0);
  assert.equal(sorted.score, 1);
});

test('filterProblems: non-array input returns []', () => {
  assert.deepEqual(filterProblems(null, {}), []);
  assert.deepEqual(filterProblems('nope', {}), []);
});

test('filterProblems: empty filterState drops entries without a known score unless includeUnknownScore is set', () => {
  const data = [
    { id: 1, status: 'tried', userScore: 50 },
    { id: 2, status: 'unattempted' },
  ];
  const strict = filterProblems(data, {});
  assert.deepEqual(
    strict.map((p) => p.id),
    [1]
  );
  const lenient = filterProblems(data, { includeUnknownScore: true });
  assert.equal(lenient.length, 2);
});

test('filterProblems: status set restricts results', () => {
  const data = [
    { id: 1, status: 'tried', userScore: 50 },
    { id: 2, status: 'solved', userScore: 100 },
    { id: 3, status: 'unattempted' },
  ];
  const out = filterProblems(data, { statuses: new Set(['solved']) });
  assert.deepEqual(
    out.map((p) => p.id),
    [2]
  );
});

test('filterProblems: score range drops matches outside [min, max]', () => {
  const data = [
    { id: 1, status: 'tried', userScore: 20 },
    { id: 2, status: 'tried', userScore: 50 },
    { id: 3, status: 'tried', userScore: 80 },
  ];
  const out = filterProblems(data, {
    statuses: ['tried'],
    scoreMin: 30,
    scoreMax: 70,
  });
  assert.deepEqual(
    out.map((p) => p.id),
    [2]
  );
});

test('filterProblems: unknown score entries honored by includeUnknownScore', () => {
  const data = [
    { id: 1, status: 'tried', userScore: null },
    { id: 2, status: 'tried', userScore: 50 },
  ];
  const kept = filterProblems(data, {
    statuses: ['tried'],
    includeUnknownScore: true,
  });
  assert.equal(kept.length, 2);

  const dropped = filterProblems(data, {
    statuses: ['tried'],
    includeUnknownScore: false,
  });
  assert.deepEqual(
    dropped.map((p) => p.id),
    [2]
  );
});

test('filterProblems: search query matches id or normalized name', () => {
  const data = [
    { id: 123, status: 'tried', userScore: 50, name: 'Șir de caractere' },
    { id: 456, status: 'tried', userScore: 50, name: 'Something else' },
  ];
  const byId = filterProblems(data, { statuses: ['tried'], searchQuery: '123' });
  assert.deepEqual(
    byId.map((p) => p.id),
    [123]
  );

  const byName = filterProblems(data, { statuses: ['tried'], searchQuery: 'sir' });
  assert.deepEqual(
    byName.map((p) => p.id),
    [123]
  );
});
