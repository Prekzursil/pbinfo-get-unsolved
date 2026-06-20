const test = require('node:test');
const assert = require('node:assert/strict');

const { parseHTML } = require('linkedom');

const {
  normalizeSpace,
  normalizeForMatch,
  getTooltipText,
  buildScoreCandidatesFromCard,
  isLikelyPbinfoNotFoundHtml,
  isLikelyPbinfoBlockedHtml,
} = require('../pbinfo-get-unsolved-enhanced.js');

test('normalizeSpace: collapses runs of whitespace and trims', () => {
  assert.equal(normalizeSpace('  a \n\t b   c '), 'a b c');
});

test('normalizeSpace: nullish/numeric input is coerced safely', () => {
  assert.equal(normalizeSpace(null), '');
  assert.equal(normalizeSpace(undefined), '');
  assert.equal(normalizeSpace(42), '42');
});

test('normalizeForMatch: strips diacritics and lowercases', () => {
  assert.equal(normalizeForMatch('Pagina nu EXISTĂ'), 'pagina nu exista');
  assert.equal(normalizeForMatch('  Ușor  '), 'usor');
});

test('getTooltipText: returns first present tooltip attribute', () => {
  const { document } = parseHTML('<a data-bs-original-title="punctaj: 60p">x</a>');
  const el = document.querySelector('a');
  assert.equal(getTooltipText(el), 'punctaj: 60p');
});

test('getTooltipText: returns empty string when no tooltip attribute present', () => {
  const { document } = parseHTML('<a>x</a>');
  const el = document.querySelector('a');
  assert.equal(getTooltipText(el), '');
});

test('buildScoreCandidatesFromCard: tooltip candidate path', () => {
  const { document } = parseHTML(
    '<div class="card mb-3"><a title="Punctaj obtinut">42 / 100</a></div>'
  );
  const card = document.querySelector('div.card.mb-3');
  const candidates = buildScoreCandidatesFromCard(card);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].value, 42);
  assert.equal(candidates[0].max, 100);
  assert.equal(candidates[0].hasRatio, true);
  assert.equal(candidates[0].isLink, true);
});

test('buildScoreCandidatesFromCard: badge fallback when no tooltip score', () => {
  const { document } = parseHTML(
    '<div class="card mb-3"><div class="card-footer">' +
      '<span class="badge">75 p</span></div></div>'
  );
  const card = document.querySelector('div.card.mb-3');
  const candidates = buildScoreCandidatesFromCard(card);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].value, 75);
  assert.equal(candidates[0].isLink, false);
});

test('buildScoreCandidatesFromCard: id-prefixed badge is ignored', () => {
  const { document } = parseHTML('<div class="card mb-3"><span class="badge">#1234</span></div>');
  const card = document.querySelector('div.card.mb-3');
  assert.deepEqual(buildScoreCandidatesFromCard(card), []);
});

test('isLikelyPbinfoNotFoundHtml: matches Romanian and 404 markers', () => {
  // normalizeForMatch strips diacritics, so the Romanian phrase matches the
  // ascii branch ('pagina nu exista').
  assert.equal(isLikelyPbinfoNotFoundHtml('<h1>Pagina nu există.</h1>'), true);
  assert.equal(isLikelyPbinfoNotFoundHtml('pagina nu exista'), true);
  // the 404 branch needs surrounding spaces (' 404 ').
  assert.equal(isLikelyPbinfoNotFoundHtml('http 404 not found'), true);
  assert.equal(isLikelyPbinfoNotFoundHtml('<h1>ok</h1>'), false);
  assert.equal(isLikelyPbinfoNotFoundHtml(null), false);
});

test('isLikelyPbinfoBlockedHtml: matches Cloudflare challenge markers', () => {
  assert.equal(isLikelyPbinfoBlockedHtml('/cdn-cgi/challenge-platform/'), true);
  assert.equal(isLikelyPbinfoBlockedHtml('cf-chl-bypass'), true);
  assert.equal(isLikelyPbinfoBlockedHtml('Attention Required!'), true);
  assert.equal(isLikelyPbinfoBlockedHtml('Security check'), true);
  assert.equal(isLikelyPbinfoBlockedHtml('<h1>ok</h1>'), false);
  assert.equal(isLikelyPbinfoBlockedHtml(null), false);
});
