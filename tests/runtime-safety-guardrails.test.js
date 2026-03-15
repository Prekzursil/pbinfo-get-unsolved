const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtimePath = path.join(__dirname, '..', 'src/core/pbinfo-runtime.js');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
const logMarkupPath = path.join(__dirname, '..', 'src/core/log-markup.js');
const logMarkupSource = fs.readFileSync(logMarkupPath, 'utf8');

test('runtime log rendering avoids DOMParser and string-built anchor HTML', () => {
  assert.match(runtimeSource, /const \{ appendSimpleMarkup \} = require\('\.\/log-markup'\);/);
  assert.match(runtimeSource, /function buildListPageLinkMessage\(listPageLink\)/);
  assert.doesNotMatch(runtimeSource, /<a href="/);
  assert.match(runtimeSource, /anchor\.href = listPageLink/);
  assert.doesNotMatch(logMarkupSource, /new DOMParser\(\)/);
  assert.doesNotMatch(logMarkupSource, /\.innerHTML\s*=/);
});
