'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseHtmlDocument } = require('../pbinfo-get-unsolved-enhanced.js');

class StubParser {
  parseFromString(text, mime) {
    return { text, mime };
  }
}

test('parseHtmlDocument: delegates to the injected ParserClass', () => {
  const doc = parseHtmlDocument('<p>hi</p>', { ParserClass: StubParser });
  assert.deepEqual(doc, { text: '<p>hi</p>', mime: 'text/html' });
});

test('parseHtmlDocument: coerces nullish responses to empty string', () => {
  const doc = parseHtmlDocument(null, { ParserClass: StubParser });
  assert.equal(doc.text, '');
});

test('parseHtmlDocument: coerces numeric responses to string', () => {
  const doc = parseHtmlDocument(42, { ParserClass: StubParser });
  assert.equal(doc.text, '42');
});

test('parseHtmlDocument: returns null when no ParserClass and no global DOMParser', () => {
  // Temporarily clear globalThis.DOMParser for this assertion.
  const original = globalThis.DOMParser;
  delete globalThis.DOMParser;
  try {
    assert.equal(parseHtmlDocument('<p>hi</p>'), null);
  } finally {
    if (original !== undefined) globalThis.DOMParser = original;
  }
});

test('parseHtmlDocument: uses globalThis.DOMParser fallback when available', () => {
  const original = globalThis.DOMParser;
  globalThis.DOMParser = StubParser;
  try {
    const doc = parseHtmlDocument('<p>hi</p>');
    assert.equal(doc.text, '<p>hi</p>');
  } finally {
    if (original === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = original;
  }
});
