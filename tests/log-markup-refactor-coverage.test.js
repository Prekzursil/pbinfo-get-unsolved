const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');

const {
  appendSimpleMarkup,
  createAllowedElement,
  parseSupportedTag,
  sanitizeHref,
  extractColorFromStyle,
} = require('../src/core/log-markup');

test('log-markup coverage tail: helper fallbacks stay explicit', () => {
  const { document } = parseHTML('<html><body><div id="target"></div></body></html>');

  assert.equal(extractColorFromStyle(null), '');
  assert.equal(sanitizeHref('/problema', undefined), 'https://www.pbinfo.ro/problema');
  assert.equal(createAllowedElement('', {}, document, 'https://www.pbinfo.ro/'), null);
  assert.equal(parseSupportedTag('</>'), null);
  assert.deepEqual(parseSupportedTag('<span style="color:#fff"   >'), {
    kind: 'open',
    tagName: 'span',
    attrs: { style: 'color:#fff' },
  });
});

test('log-markup coverage tail: appendSimpleMarkup handles matched tags and missing document location', () => {
  const { document } = parseHTML('<html><body><div id="target"></div></body></html>');
  const target = document.getElementById('target');
  const originalLocation = document.location;

  document.location = null;
  try {
    appendSimpleMarkup(target, '<b>ok</b>', {});
  } finally {
    document.location = originalLocation;
  }

  assert.equal(target.innerHTML, '<b>ok</b>');
});
