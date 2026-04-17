'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeRenderShape } = require('../pbinfo-get-unsolved-enhanced.js');

function mk(n) {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
}

test('computeRenderShape: default chunk size is 150, floor 25', () => {
  const { chunkSize } = computeRenderShape([]);
  assert.equal(chunkSize, 150);
  const small = computeRenderShape([], { tableRenderChunkSize: 10 });
  assert.equal(small.chunkSize, 25); // floor clamp
});

test('computeRenderShape: custom chunk size passes through', () => {
  const { chunkSize } = computeRenderShape([], { tableRenderChunkSize: 300 });
  assert.equal(chunkSize, 300);
});

test('computeRenderShape: non-finite chunk size falls back to 150', () => {
  const { chunkSize } = computeRenderShape([], { tableRenderChunkSize: Number.NaN });
  assert.equal(chunkSize, 150);
});

test('computeRenderShape: virtualize true + list > limit slices', () => {
  const { shouldVirtualize, list, total } = computeRenderShape(mk(200), {
    virtualizeRows: true,
    virtualRowsLimit: 50,
  });
  assert.equal(shouldVirtualize, true);
  assert.equal(list.length, 50);
  assert.equal(total, 200);
});

test('computeRenderShape: virtualize true + list <= limit keeps all rows', () => {
  const { shouldVirtualize, list } = computeRenderShape(mk(40), {
    virtualizeRows: true,
    virtualRowsLimit: 50,
  });
  assert.equal(shouldVirtualize, false);
  assert.equal(list.length, 40);
});

test('computeRenderShape: virtualize disabled keeps full list regardless of size', () => {
  const { shouldVirtualize, list } = computeRenderShape(mk(500), {
    virtualizeRows: false,
    virtualRowsLimit: 10,
  });
  assert.equal(shouldVirtualize, false);
  assert.equal(list.length, 500);
});

test('computeRenderShape: non-array input yields empty list', () => {
  const { list, total } = computeRenderShape(null);
  assert.deepEqual(list, []);
  assert.equal(total, 0);
});

test('computeRenderShape: non-finite virtualRowsLimit disables virtualize', () => {
  const { shouldVirtualize } = computeRenderShape(mk(500), {
    virtualizeRows: true,
    virtualRowsLimit: 'x',
  });
  assert.equal(shouldVirtualize, false);
});
