const test = require('node:test');
const assert = require('node:assert/strict');

const { parseHTML } = require('linkedom');

const {
  appendSimpleMarkup,
  createAllowedElement,
  parseSupportedTag,
  isAsciiLettersOnly,
  isHexColor,
  extractColorFromStyle,
  skipWhitespace,
  readAttributeName,
  readQuotedAttributeValue,
  readAttributeEntry,
  findTagBounds,
  sanitizeHref,
  isSafeColor,
  escapeRegExp,
} = require('../src/core');

function getDocument(html = '<div id="root"></div>') {
  return parseHTML(html).document;
}

test('log markup helpers parse supported tags and sanitize URLs', () => {
  assert.deepEqual(parseSupportedTag('<b>'), { kind: 'open', tagName: 'b', attrs: {} });
  assert.deepEqual(parseSupportedTag('</span>'), { kind: 'close', tagName: 'span', attrs: {} });
  assert.deepEqual(parseSupportedTag('<br />'), { kind: 'void', tagName: 'br', attrs: {} });
  assert.equal(parseSupportedTag('<script>alert(1)</script>'), null);
  assert.equal(parseSupportedTag('plain text'), null);
  assert.equal(parseSupportedTag('</1bad>'), null);
  assert.equal(parseSupportedTag('<1bad>'), null);
  assert.equal(isSafeColor('#b35c00'), true);
  assert.equal(isSafeColor('rebeccapurple'), true);
  assert.equal(isSafeColor(42), false);
  assert.equal(isSafeColor('url(javascript:alert(1))'), false);
  assert.equal(isAsciiLettersOnly('Blue'), true);
  assert.equal(isAsciiLettersOnly(''), false);
  assert.equal(isHexColor('#12xz'), false);
  assert.equal(extractColorFromStyle('background:red'), '');
  assert.equal(extractColorFromStyle('broken-declaration'), '');
  assert.equal(skipWhitespace('  x', 0), 2);
  assert.deepEqual(readAttributeName('href="/safe"', 0), {
    attributeName: 'href',
    nextIndex: 4,
  });
  assert.equal(readAttributeName('="oops"', 0), null);
  assert.deepEqual(readQuotedAttributeValue('value"', 0), {
    value: 'value',
    nextIndex: 6,
  });
  assert.equal(readQuotedAttributeValue('unterminated', 0), null);
  assert.deepEqual(readAttributeEntry('href="/safe"', 0), {
    attributeName: 'href',
    value: '/safe',
    nextIndex: 12,
  });
  assert.equal(readAttributeEntry('href', 0), null);
  assert.equal(
    sanitizeHref('/?pagina=probleme-lista', 'https://www.pbinfo.ro/probleme'),
    'https://www.pbinfo.ro/?pagina=probleme-lista'
  );
  assert.equal(sanitizeHref('java' + 'script:alert(1)', 'https://www.pbinfo.ro/'), null);
});

test('appendSimpleMarkup renders only supported formatting and safe links', () => {
  const document = getDocument();
  const root = document.getElementById('root');

  appendSimpleMarkup(
    root,
    'Start <b>bold</b> <span style="color:#b30000;">red</span> <a href="/problema/1"><i>link</i></a> <script>ignored()</script>',
    { baseUrl: 'https://www.pbinfo.ro/lista' }
  );

  assert.equal(root.textContent, 'Start bold red link <script>ignored()</script>');
  assert.equal(root.querySelector('b').textContent, 'bold');
  assert.equal(root.querySelector('span').style.color, '#b30000');
  assert.equal(root.querySelector('a').href, 'https://www.pbinfo.ro/problema/1');
  assert.equal(root.querySelector('a').rel, 'noopener noreferrer');
  assert.equal(root.querySelector('a i').textContent, 'link');
});

test('appendSimpleMarkup falls back to text for unsupported or unsafe markup', () => {
  const document = getDocument();
  const root = document.getElementById('root');

  appendSimpleMarkup(
    root,
    'Unsafe <a href="' + 'java' + 'script:alert(1)">bad</a> <em>plain</em> <u>ok</u>',
    { baseUrl: 'https://www.pbinfo.ro/' }
  );

  assert.equal(
    root.textContent,
    'Unsafe <a href="' + 'java' + 'script:alert(1)">bad</a> <em>plain</em> ok'
  );
  assert.equal(root.querySelector('a'), null);
  assert.equal(root.querySelector('em'), null);
  assert.equal(root.querySelector('u').textContent, 'ok');
});

test('log markup helpers cover default base URL and invalid tag fallbacks', () => {
  const document = getDocument();
  const root = document.getElementById('root');

  Object.defineProperty(document, 'location', {
    value: null,
    configurable: true,
  });

  appendSimpleMarkup(root, '<a href="/problema/1">link</a><br>< > tail', null);

  assert.equal(root.querySelector('a').href, 'https://www.pbinfo.ro/problema/1');
  assert.notEqual(root.querySelector('br'), null);
  assert.equal(root.textContent, 'link< > tail');
  assert.equal(findTagBounds('plain text', 0), null);
  assert.equal(findTagBounds('plain <b', 0), null);
  assert.equal(sanitizeHref('', 'https://www.pbinfo.ro/'), null);
  assert.equal(sanitizeHref('ht' + 'tp://[', 'https://www.pbinfo.ro/'), null);
  assert.equal(escapeRegExp('a+b?(c)'), String.raw`a\+b\?\(c\)`);
});

test('appendSimpleMarkup preserves malformed tags and strips unsafe styling branches', () => {
  const document = getDocument();
  const root = document.getElementById('root');

  appendSimpleMarkup(
    root,
    '<span style="background:red">plain</span><span style="color:url(javascript:bad)">no-color</span><b title="unterminated>raw',
    { baseUrl: 'https://www.pbinfo.ro/' }
  );

  const spans = root.querySelectorAll('span');
  assert.equal(spans.length, 2);
  assert.equal(spans[0].style.color || '', '');
  assert.equal(spans[1].style.color || '', '');
  assert.match(root.textContent, /raw$/);
});

test('appendSimpleMarkup keeps mismatched close tags and unsafe anchors as text', () => {
  const document = getDocument();
  const root = document.getElementById('root');

  appendSimpleMarkup(root, '<b>bold</i> <a href="">empty</a> <a href="/safe">ok</a>', {
    baseUrl: 'https://www.pbinfo.ro/',
  });

  assert.match(root.textContent, /bold<\/i>/);
  assert.equal(root.querySelectorAll('a').length, 1);
  assert.equal(root.querySelector('a').href, 'https://www.pbinfo.ro/safe');
});

test('log markup helpers create only safe elements and styling', () => {
  const document = getDocument();
  const safeSpan = createAllowedElement(
    'span',
    { style: 'color:#123abc' },
    document,
    'https://www.pbinfo.ro/'
  );
  const unsafeSpan = createAllowedElement(
    'span',
    { style: 'background:red' },
    document,
    'https://www.pbinfo.ro/'
  );

  assert.equal(createAllowedElement('em', {}, document, 'https://www.pbinfo.ro/'), null);
  assert.equal(createAllowedElement('a', { href: '' }, document, 'https://www.pbinfo.ro/'), null);
  assert.equal(safeSpan.style.color, '#123abc');
  assert.equal(unsafeSpan.style.color || '', '');
});

test('log markup helpers cover empty names, invalid attributes, and empty markup input', () => {
  const document = getDocument();
  const root = document.getElementById('root');

  appendSimpleMarkup(root, null, { baseUrl: '   ' });

  assert.equal(parseSupportedTag('</>'), null);
  assert.deepEqual(parseSupportedTag('<a   >'), { kind: 'open', tagName: 'a', attrs: {} });
  assert.equal(parseSupportedTag('<a href="/safe"   >').attrs.href, '/safe');
  assert.equal(readAttributeEntry('1bad="value"', 0), null);
  assert.equal(
    readAttributeName(
      {
        length: 1,
        0: {
          codePointAt() {
            return undefined;
          },
        },
      },
      0
    ),
    null
  );
  assert.equal(root.textContent, '');
});
