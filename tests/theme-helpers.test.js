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

test('applyThemeAttribute: system value deletes dataset.theme', () => {
  const el = { dataset: { theme: 'dark' } };
  applyThemeAttribute(el, 'system');
  assert.equal(el.dataset.theme, undefined);
});

test('applyThemeAttribute: dark value sets dataset.theme', () => {
  const el = { dataset: {} };
  applyThemeAttribute(el, 'dark');
  assert.equal(el.dataset.theme, 'dark');
});

test('applyThemeAttribute: missing el / dataset returns resolved value without throwing', () => {
  assert.equal(applyThemeAttribute(null, 'dark'), 'dark');
  assert.equal(applyThemeAttribute({}, 'dark'), 'dark');
});
