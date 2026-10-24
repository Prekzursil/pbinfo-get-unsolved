const test = require('node:test');
const assert = require('node:assert/strict');

const { parseHTML } = require('linkedom');

const { appendLogMarkup } = require('../pbinfo-get-unsolved-enhanced.js');

function newLogLine() {
  const { document } = parseHTML('<!doctype html><html><body><div></div></body></html>');
  return { document, line: document.querySelector('div') };
}

// Plain-data view of a rendered log line: text nodes become strings, elements
// become { tag, attrs, children } with only the attributes the renderer sets.
function shape(node) {
  return Array.from(node.childNodes, (child) => {
    if (child.nodeType === 3) return child.textContent;
    const attrs = {};
    for (const name of ['style', 'href']) {
      if (child.hasAttribute(name)) attrs[name] = child.getAttribute(name);
    }
    return { tag: child.tagName.toLowerCase(), attrs, children: shape(child) };
  });
}

test('appendLogMarkup: plain text stays a single text node', () => {
  const { document, line } = newLogLine();
  const result = appendLogMarkup(document, line, 'Snapshot salvat (local).');
  assert.equal(result, line);
  assert.deepEqual(shape(line), ['Snapshot salvat (local).']);
});

test('appendLogMarkup: empty and non-string messages', () => {
  const { document, line } = newLogLine();
  appendLogMarkup(document, line, '');
  assert.deepEqual(shape(line), []);
  appendLogMarkup(document, line, 42);
  assert.deepEqual(shape(line), ['42']);
});

test('appendLogMarkup: bold, italic and underline around and between text', () => {
  const { document, line } = newLogLine();
  appendLogMarkup(document, line, 'Start ID: <b>12</b>, <i>gata</i> <u>acum</u>.');
  assert.deepEqual(shape(line), [
    'Start ID: ',
    { tag: 'b', attrs: {}, children: ['12'] },
    ', ',
    { tag: 'i', attrs: {}, children: ['gata'] },
    ' ',
    { tag: 'u', attrs: {}, children: ['acum'] },
    '.',
  ]);
});

test('appendLogMarkup: a message that starts and ends with a tag', () => {
  const { document, line } = newLogLine();
  appendLogMarkup(document, line, '<b>Scanare pusă pe pauză.</b>');
  assert.deepEqual(shape(line), [{ tag: 'b', attrs: {}, children: ['Scanare pusă pe pauză.'] }]);
});

test('appendLogMarkup: colored span with nested bold', () => {
  const { document, line } = newLogLine();
  appendLogMarkup(
    document,
    line,
    '<span style="color:#b35c00;"><b>Debug:</b> activ (limită dump=5).</span>'
  );
  assert.deepEqual(shape(line), [
    {
      tag: 'span',
      attrs: { style: 'color:#b35c00;' },
      children: [{ tag: 'b', attrs: {}, children: ['Debug:'] }, ' activ (limită dump=5).'],
    },
  ]);
});

test('appendLogMarkup: http(s) link with an italic label', () => {
  const { document, line } = newLogLine();
  const url = 'https://www.pbinfo.ro/?pagina=probleme-lista&clasa=9';
  appendLogMarkup(document, line, `Link: <a href="${url}"><i>${url}</i></a>`);
  assert.deepEqual(shape(line), [
    'Link: ',
    { tag: 'a', attrs: { href: url }, children: [{ tag: 'i', attrs: {}, children: [url] }] },
  ]);
});

test('appendLogMarkup: anything outside the vocabulary is rendered as text', () => {
  const { document, line } = newLogLine();
  const hostile =
    '<img src=x onerror="alert(1)"><script>alert(1)</script>' +
    '<a href="javascript:alert(1)">x</a><span style="background:url(x)">y</span>';
  appendLogMarkup(document, line, hostile);
  assert.equal(line.children.length, 0);
  assert.equal(line.textContent, hostile);
});

test('appendLogMarkup: a mismatched closing tag is text, the matching one closes', () => {
  const { document, line } = newLogLine();
  appendLogMarkup(document, line, '<b>bold</i> still bold</b> after');
  assert.deepEqual(shape(line), [
    { tag: 'b', attrs: {}, children: ['bold', '</i>', ' still bold'] },
    ' after',
  ]);
});

test('appendLogMarkup: an unclosed tag keeps the rest of the line', () => {
  const { document, line } = newLogLine();
  appendLogMarkup(document, line, 'x <u>unterminated');
  assert.deepEqual(shape(line), ['x ', { tag: 'u', attrs: {}, children: ['unterminated'] }]);
});
