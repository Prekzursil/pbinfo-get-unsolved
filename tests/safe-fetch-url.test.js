'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { safePbinfoFetchUrl } = require('../pbinfo-get-unsolved-enhanced.js');

test('safePbinfoFetchUrl: accepts https pbinfo hosts', () => {
  assert.equal(
    safePbinfoFetchUrl('https://www.pbinfo.ro/probleme'),
    'https://www.pbinfo.ro/probleme'
  );
  assert.equal(
    safePbinfoFetchUrl('https://pbinfo.ro/probleme/12'),
    'https://pbinfo.ro/probleme/12'
  );
});

test('safePbinfoFetchUrl: resolves relative paths against the pbinfo base', () => {
  const out = safePbinfoFetchUrl('/probleme?pagina=probleme-lista');
  assert.equal(out, 'https://www.pbinfo.ro/probleme?pagina=probleme-lista');
});

test('safePbinfoFetchUrl: rejects off-origin hosts', () => {
  assert.equal(safePbinfoFetchUrl('https://evil.example.com/x'), null);
});

test('safePbinfoFetchUrl: rejects non-https schemes', () => {
  assert.equal(safePbinfoFetchUrl('http://www.pbinfo.ro/x'), null);
  assert.equal(safePbinfoFetchUrl('ftp://www.pbinfo.ro/x'), null);
  assert.equal(safePbinfoFetchUrl('javascript:alert(1)'), null);
});

test('safePbinfoFetchUrl: null / undefined / empty return null', () => {
  assert.equal(safePbinfoFetchUrl(null), null);
  assert.equal(safePbinfoFetchUrl(undefined), null);
  assert.equal(safePbinfoFetchUrl(''), null);
});

test('safePbinfoFetchUrl: absolute URL with bad base still rejects wrong host', () => {
  // Absolute URL always wins over the base, regardless of its value.
  assert.equal(
    safePbinfoFetchUrl('https://elsewhere.invalid/x', { base: 'https://www.pbinfo.ro/' }),
    null
  );
});

test('safePbinfoFetchUrl: custom base still enforces host allow-list', () => {
  assert.equal(
    safePbinfoFetchUrl('/x', { base: 'https://evil.example.com/' }),
    null
  );
});
