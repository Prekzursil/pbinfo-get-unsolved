'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveThemeValue,
  loadStoredTheme,
  applyThemeAttribute,
} = require('../pbinfo-get-unsolved-enhanced.js');

function makeStorage(values = {}) {
  return {
    getItem: (k) => (Object.hasOwn(values, k) ? values[k] : null),
    setItem: () => {},
    removeItem: () => {},
  };
}

test('resolveThemeValue: passes through allowed values', () => {
  assert.equal(resolveThemeValue('light'), 'light');
  assert.equal(resolveThemeValue('dark'), 'dark');
  assert.equal(resolveThemeValue('system'), 'system');
});

test('resolveThemeValue: unknown values fall back to system', () => {
  assert.equal(resolveThemeValue('neon'), 'system');
  assert.equal(resolveThemeValue(null), 'system');
  assert.equal(resolveThemeValue(undefined), 'system');
  assert.equal(resolveThemeValue(42), 'system');
});

test('loadStoredTheme: storage returning valid value passes through', () => {
  assert.equal(loadStoredTheme(makeStorage({ t: 'dark' }), 't'), 'dark');
});

test('loadStoredTheme: storage returning unknown falls back to system', () => {
  assert.equal(loadStoredTheme(makeStorage({ t: 'neon' }), 't'), 'system');
});

test('loadStoredTheme: missing storage returns system', () => {
  assert.equal(loadStoredTheme(null, 't'), 'system');
});

test('loadStoredTheme: throwing storage returns system', () => {
  const throwing = {
    getItem() {
      throw new Error('nope');
    },
  };
  assert.equal(loadStoredTheme(throwing, 't'), 'system');
});

test('applyThemeAttribute: system value removes data-theme', () => {
  const calls = { remove: 0, set: 0 };
  const el = {
    removeAttribute: () => (calls.remove += 1),
    setAttribute: () => (calls.set += 1),
  };
  applyThemeAttribute(el, 'system');
  assert.equal(calls.remove, 1);
  assert.equal(calls.set, 0);
});

test('applyThemeAttribute: dark value sets data-theme', () => {
  const el = {
    lastSet: null,
    removeAttribute: () => {},
    setAttribute: (k, v) => {
      el.lastSet = { k, v };
    },
  };
  applyThemeAttribute(el, 'dark');
  assert.deepEqual(el.lastSet, { k: 'data-theme', v: 'dark' });
});

test('applyThemeAttribute: missing el returns resolved value without throwing', () => {
  assert.equal(applyThemeAttribute(null, 'dark'), 'dark');
  assert.equal(applyThemeAttribute({ setAttribute: 'not-a-fn' }, 'dark'), 'dark');
});
