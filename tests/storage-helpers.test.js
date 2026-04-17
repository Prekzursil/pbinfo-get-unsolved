'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  storageGetJson,
  storageSetJson,
  storageRemove,
} = require('../pbinfo-get-unsolved-enhanced.js');

function makeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem(k) {
      return m.has(k) ? m.get(k) : null;
    },
    setItem(k, v) {
      m.set(String(k), String(v));
    },
    removeItem(k) {
      m.delete(String(k));
    },
    _data: m,
  };
}

test('storageGetJson: returns parsed object or null, tolerates missing keys', () => {
  const s = makeStorage({ a: JSON.stringify({ v: 1 }), bad: 'not-json' });
  assert.deepEqual(storageGetJson('a', s), { v: 1 });
  assert.equal(storageGetJson('missing', s), null);
  assert.equal(storageGetJson('bad', s), null);
});

test('storageGetJson: walks a key list and returns the first object match', () => {
  const s = makeStorage({ b: JSON.stringify({ v: 2 }), c: JSON.stringify({ v: 3 }) });
  const out = storageGetJson(['missing', 'b', 'c'], s);
  assert.deepEqual(out, { v: 2 });
});

test('storageGetJson: empty key list or missing storage returns null', () => {
  assert.equal(storageGetJson([], makeStorage()), null);
  assert.equal(storageGetJson('a', null), null);
  assert.equal(storageGetJson([null, ''], makeStorage()), null);
});

test('storageGetJson: swallows throwing storage getters and moves on', () => {
  const first = {
    getItem() {
      throw new Error('boom');
    },
  };
  // Falls through — returns null because we only have one key and it threw.
  assert.equal(storageGetJson('a', first), null);
});

test('storageSetJson: writes JSON and reports quota classification on error', () => {
  const s = makeStorage();
  const ok = storageSetJson('k', { n: 1 }, s);
  assert.deepEqual(ok, { ok: true, errorType: null });
  assert.equal(s._data.get('k'), '{"n":1}');

  const quotaStorage = {
    setItem() {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    },
  };
  const fail = storageSetJson('k', { n: 1 }, quotaStorage);
  assert.equal(fail.ok, false);
  assert.equal(fail.errorType, 'quota');

  const genericStorage = {
    setItem() {
      throw new Error('other');
    },
  };
  const gen = storageSetJson('k', { n: 1 }, genericStorage);
  assert.equal(gen.errorType, 'unknown');
});

test('storageSetJson: missing key or storage returns unknown error', () => {
  assert.deepEqual(storageSetJson('', {}, makeStorage()), {
    ok: false,
    errorType: 'unknown',
  });
  assert.deepEqual(storageSetJson('k', {}, null), { ok: false, errorType: 'unknown' });
});

test('storageRemove: removes one or many keys and tolerates throws', () => {
  const s = makeStorage({ a: '1', b: '2', c: '3' });
  storageRemove(['a', 'c'], s);
  assert.equal(s._data.has('a'), false);
  assert.equal(s._data.has('b'), true);
  assert.equal(s._data.has('c'), false);

  const throwing = {
    removeItem() {
      throw new Error('nope');
    },
  };
  // Should not throw despite storage error.
  storageRemove(['k'], throwing);

  // Missing storage is a no-op.
  storageRemove('k', null);
});
