'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldEmitDebugDump,
  describeClipboardError,
} = require('../pbinfo-get-unsolved-enhanced.js');

test('shouldEmitDebugDump: disabled config always returns false', () => {
  assert.equal(shouldEmitDebugDump(1, { enabled: false, dumped: 0, limit: 10 }), false);
  assert.equal(shouldEmitDebugDump(1, {}), false);
});

test('shouldEmitDebugDump: honors dumped-vs-limit threshold', () => {
  assert.equal(shouldEmitDebugDump(1, { enabled: true, dumped: 2, limit: 3 }), true);
  assert.equal(shouldEmitDebugDump(1, { enabled: true, dumped: 3, limit: 3 }), false);
  assert.equal(shouldEmitDebugDump(1, { enabled: true, dumped: 99, limit: 10 }), false);
});

test('shouldEmitDebugDump: ids filter restricts to allow-listed ids', () => {
  const ids = new Set([5, 6]);
  assert.equal(shouldEmitDebugDump(5, { enabled: true, dumped: 0, limit: 10, ids }), true);
  assert.equal(shouldEmitDebugDump(7, { enabled: true, dumped: 0, limit: 10, ids }), false);
  // null ids set = no id filter, everything passes
  assert.equal(shouldEmitDebugDump(99, { enabled: true, dumped: 0, limit: 10, ids: null }), true);
});

test('describeClipboardError: non-secure context takes priority', () => {
  const msg = describeClipboardError({ isSecureContext: false });
  assert.ok(msg.includes('HTTPS'));
});

test('describeClipboardError: NotAllowedError surfaces the permission hint', () => {
  const msg = describeClipboardError({
    clipboardApiError: { name: 'NotAllowedError' },
  });
  assert.ok(msg.includes('Permisiune'));
});

test('describeClipboardError: secure modern browser blocks falls through to the secure-block hint', () => {
  const msg = describeClipboardError(new Error('nope'), {
    navigator: { clipboard: { writeText: async () => {} } },
    isSecureContext: true,
  });
  assert.ok(msg.includes('Browserul a blocat'));
});

test('describeClipboardError: no clipboard api falls through to the generic hint', () => {
  const msg = describeClipboardError(new Error('nope'), {
    navigator: null,
    isSecureContext: false,
  });
  assert.ok(msg.includes('Clipboard indisponibil'));
});
