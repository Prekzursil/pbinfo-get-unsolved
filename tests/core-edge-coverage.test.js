const test = require('node:test');
const assert = require('node:assert/strict');

const { parseHTML } = require('linkedom');

const {
  parseScoreText,
  selectScoreFromCandidates,
  getTooltipText,
  buildScoreCandidatesFromCard,
  extractScoreInfoFromProblemPage,
  extractProblemMetaFromProblemPage,
  classifyProblemStatus,
  isLikelyPbinfoNotFoundHtml,
  isLikelyPbinfoBlockedHtml,
  parseTotalProblems,
  normalizeListUrl,
  buildPageUrl,
  computeBackoffWithJitter,
  nextAdaptiveThrottleState,
  detectPbinfoUserNamespace,
} = require('../src/core');

function getDocument(html) {
  return parseHTML(html).document;
}

function getCard(html) {
  return getDocument(html).querySelector('.card');
}

test('core edges: score parsing candidate fallbacks', () => {
  const tooltipDocument = getDocument(
    '<div class="card"><a id="tooltip" data-original-title="Punctaj utilizator">10p</a></div>'
  );
  const badgeCard = getCard(
    '<div class="card"><a class="btn"><span class="badge">25p</span> Rezolva</a><span class="badge">#123</span></div>'
  );
  const noisyTooltipCard = getCard(
    '<div class="card"><span title="">ignored</span><span title="Alt text">12p</span><span title="Punctaj">fara cifre</span></div>'
  );
  const skippedBadgeCard = getCard(
    '<div class="card"><span class="badge">abc</span><span class="badge">7</span></div>'
  );
  const tooltipOnlyCard = getCard(
    '<div class="card"><span title="Punctaj utilizator: 87/100">status</span></div>'
  );

  assert.equal(getTooltipText(tooltipDocument.getElementById('tooltip')), 'Punctaj utilizator');
  assert.equal(parseScoreText(''), null);
  assert.deepEqual(buildScoreCandidatesFromCard(null), []);
  assert.deepEqual(buildScoreCandidatesFromCard(noisyTooltipCard), []);
  assert.deepEqual(buildScoreCandidatesFromCard(skippedBadgeCard), []);
  assert.deepEqual(
    selectScoreFromCandidates([{ tooltip: 'punctaj', text: 'fara numar', value: null }]),
    { userScore: null, maxScore: null }
  );

  const badgeCandidates = buildScoreCandidatesFromCard(badgeCard);
  assert.equal(badgeCandidates.length, 1);
  assert.equal(badgeCandidates[0].value, 25);
  const tooltipOnlyCandidates = buildScoreCandidatesFromCard(tooltipOnlyCard);
  assert.equal(tooltipOnlyCandidates.length, 1);
  assert.equal(tooltipOnlyCandidates[0].value, 87);
  assert.equal(tooltipOnlyCandidates[0].max, 100);
});

test('core edges: score parsing mixed sources and empty-score pages', () => {
  const mixedSourceCard = getCard(
    '<div class="card"><span title="Punctaj utilizator: 33/100">status</span><span class="badge">45/100</span></div>'
  );
  const duplicateElementCard = getCard(
    '<div class="card"><span class="badge" title="Punctaj utilizator">50 / 100</span></div>'
  );
  const noScorePage = getDocument(
    '<table><tr><td id="scor_utilizator_problema">fara scor</td></tr></table>'
  );

  const mixedCandidates = buildScoreCandidatesFromCard(mixedSourceCard);
  assert.equal(mixedCandidates.length, 2);
  assert.deepEqual(
    mixedCandidates
      .map((entry) => entry.value)
      .sort(function (left, right) {
        return left - right;
      }),
    [33, 45]
  );

  const duplicateCandidates = buildScoreCandidatesFromCard(duplicateElementCard);
  assert.equal(duplicateCandidates.length, 1);
  assert.equal(duplicateCandidates[0].value, 50);

  const noScoreInfo = extractScoreInfoFromProblemPage(noScorePage);
  assert.equal(noScoreInfo.userScore, null);
  assert.equal(noScoreInfo.maxScore, null);
  assert.equal(noScoreInfo.candidates.length, 0);
});

test('core edges: meta extraction paths and title normalization fallbacks', () => {
  const titleFallbackDocument = getDocument(
    '<html><head><title>Fallback Problem - pbinfo.ro</title></head><body><table><tr><td>-</td><td>-</td><td>Concur</td><td id="scor_utilizator_problema">Scor indisponibil</td></tr></table></body></html>'
  );
  const emptyMetaDocument = getDocument('<html><body><div>empty</div></body></html>');
  const fallbackPrefixedTitleDocument = getDocument(
    '<html><head><title>#123 Fallback Prefix - pbinfo.ro</title></head><body><table><tr><td>poster</td><td>-</td><td>-</td><td>medie</td><td id="scor_utilizator_problema"><span>10 / 100</span></td></tr></table></body></html>'
  );
  const metaDocument = getDocument(
    '<html><head><meta property="og:title" content="Problema Fancy - pbinfo.ro" /></head><body><table><tr><td><a href="https://www.pbinfo.ro/utilizator/12/tester"><img src="https://cdn.example/avatar.png" /> Tester</a></td><td>Source Name</td><td>Author Name</td><td>Dificil</td><td id="scor_utilizator_problema"><span>50 / 100</span></td></tr></table></body></html>'
  );
  const prefixedTitleDocument = getDocument(
    '<html><body><h1>#123 problema mea</h1><table><tr><td>poster</td><td>sursa</td><td>autor</td><td>usoara</td><td id="scor_utilizator_problema"><span>10 / 100</span></td></tr></table></body></html>'
  );
  const plainTitleDocument = getDocument(
    '<html><body><h1>Problema fara prefix</h1><table><tr><td>poster</td><td>sursa</td><td>autor</td><td>medie</td><td id="scor_utilizator_problema"><span>10 / 100</span></td></tr></table></body></html>'
  );
  const overlappingIdTitleDocument = getDocument(
    '<html><body><h1>#1234 problema cu id extins</h1><table><tr><td>poster</td><td>sursa</td><td>autor</td><td>dificila</td><td id="scor_utilizator_problema"><span>10 / 100</span></td></tr></table></body></html>'
  );

  const meta = extractProblemMetaFromProblemPage(metaDocument, null);
  assert.equal(meta.name, 'Problema Fancy');
  assert.equal(meta.difficulty, 2);
  assert.equal(meta.source, 'Source Name');
  assert.equal(meta.author, 'Author Name');
  assert.equal(meta.postedBy_name, 'Tester');
  assert.equal(meta.postedBy_img, 'https://cdn.example/avatar.png');

  const fallbackMeta = extractProblemMetaFromProblemPage(titleFallbackDocument, null);
  assert.equal(fallbackMeta.name, 'Fallback Problem');
  assert.equal(fallbackMeta.author, '');
  assert.equal(fallbackMeta.source, '');
  assert.equal(fallbackMeta.difficulty, 3);
  assert.equal(
    extractProblemMetaFromProblemPage(fallbackPrefixedTitleDocument, 123).name,
    'Fallback Prefix'
  );
  assert.equal(extractProblemMetaFromProblemPage(prefixedTitleDocument, 123).name, 'problema mea');
  assert.equal(
    extractProblemMetaFromProblemPage(plainTitleDocument, null).name,
    'Problema fara prefix'
  );
  assert.equal(
    extractProblemMetaFromProblemPage(overlappingIdTitleDocument, 123).name,
    '#1234 problema cu id extins'
  );
  assert.equal(extractProblemMetaFromProblemPage(emptyMetaDocument, null).name, '');
});

test('core edges: classify fallback defaults to unattempted', () => {
  assert.equal(classifyProblemStatus(null), 'unattempted');
});

test('core edges: network URL and HTML helper fallback branches', () => {
  assert.equal(isLikelyPbinfoNotFoundHtml('Pagina nu exista'), true);
  assert.equal(isLikelyPbinfoNotFoundHtml('pagina valida'), false);
  assert.equal(isLikelyPbinfoNotFoundHtml(), false);
  assert.equal(isLikelyPbinfoBlockedHtml('cf-chl challenge'), true);
  assert.equal(isLikelyPbinfoBlockedHtml('plain html'), false);
  assert.equal(isLikelyPbinfoBlockedHtml(), false);
  assert.equal(parseTotalProblems('<div>missing</div>'), null);
  assert.equal(parseTotalProblems('<span class="numar_probleme">42</span>'), 42);
  assert.equal(normalizeListUrl('', '', 'start'), null);
  assert.equal(normalizeListUrl('::::', '', 'start'), null);
  assert.equal(
    normalizeListUrl('https://www.pbinfo.ro/?pagina=probleme-lista&start=20', '', ''),
    'https://www.pbinfo.ro/?pagina=probleme-lista'
  );
  assert.equal(
    normalizeListUrl(
      '/?pagina=probleme-lista&start=10',
      'https://www.pbinfo.ro/categorie',
      'start'
    ),
    'https://www.pbinfo.ro/?pagina=probleme-lista'
  );
  assert.equal(buildPageUrl(null, { pageIndex: 1 }), null);
  assert.equal(buildPageUrl('https://www.pbinfo.ro/', null), null);
  assert.equal(buildPageUrl('https://[::1', { pageIndex: 1 }), null);
  assert.equal(
    buildPageUrl('https://www.pbinfo.ro/?pagina=probleme-lista', {
      pageIndex: 2,
      mode: 'page',
      param: 'page',
      pageBase: 5,
    }),
    'https://www.pbinfo.ro/?pagina=probleme-lista&page=6'
  );
  assert.equal(
    buildPageUrl('https://www.pbinfo.ro/?pagina=probleme-lista', {
      pageIndex: 1,
      pageSize: Number.NaN,
      mode: 'offset',
      param: '',
      pageBase: Number.NaN,
    }),
    'https://www.pbinfo.ro/?pagina=probleme-lista&start=0'
  );
});

test('core edges: backoff jitter fallback branches', () => {
  const cryptoBefore = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

  assert.equal(computeBackoffWithJitter(2, { baseMs: 100, capMs: 250, jitter: false }), 250);

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues(target) {
        target[0] = 0x40000000;
        return target;
      },
    },
  });
  try {
    assert.equal(
      computeBackoffWithJitter(0, { baseMs: 100, capMs: 250, random: () => Number.NaN }),
      0
    );
    assert.equal(computeBackoffWithJitter(0, { baseMs: 100, capMs: 250 }), 25);
    assert.equal(computeBackoffWithJitter(-4, { baseMs: 0, capMs: 0, random: () => 2 }), 1);
  } finally {
    if (cryptoBefore) {
      Object.defineProperty(globalThis, 'crypto', cryptoBefore);
    } else {
      delete globalThis.crypto;
    }
  }

  assert.equal(computeBackoffWithJitter(1, { baseMs: 10, capMs: 100, random: () => -1 }), 0);
});

test('core edges: adaptive throttle fallback branches', () => {
  assert.deepEqual(
    nextAdaptiveThrottleState({ enabled: false, delayMs: 5, concurrency: 2 }, 'success'),
    {
      enabled: false,
      baseDelayMs: 0,
      baseConcurrency: 1,
      delayMs: 5,
      concurrency: 2,
      cleanStreak: 0,
    }
  );
  assert.equal(
    nextAdaptiveThrottleState(
      {
        enabled: true,
        baseDelayMs: 100,
        baseConcurrency: 3,
        delayMs: 200,
        concurrency: 1,
        cleanStreak: 19,
      },
      'success'
    ).concurrency,
    2
  );
});

test('core edges: adaptive throttle blocked and network branches', () => {
  assert.equal(
    nextAdaptiveThrottleState(
      {
        enabled: true,
        baseDelayMs: 100,
        baseConcurrency: 3,
        delayMs: 200,
        concurrency: 2,
        cleanStreak: 0,
      },
      'blocked'
    ).concurrency,
    1
  );
  assert.equal(
    nextAdaptiveThrottleState(
      {
        enabled: true,
        baseDelayMs: 100,
        baseConcurrency: 3,
        delayMs: 200,
        concurrency: 2,
        cleanStreak: 0,
      },
      'network'
    ).concurrency,
    1
  );
  assert.deepEqual(nextAdaptiveThrottleState(null, 'success', null), {
    enabled: true,
    baseDelayMs: 0,
    baseConcurrency: 1,
    delayMs: 0,
    concurrency: 1,
    cleanStreak: 1,
  });
});

test('core edges: detect namespace fallback branches', () => {
  const mixedNamespaceDocument = getDocument(`
    <main><a href="https://www.pbinfo.ro/utilizator/99/article-user">Article User</a></main>
    <header><a href="https://www.pbinfo.ro/utilizator/not-valid">Broken User</a></header>
    <div><a href="https://www.pbinfo.ro/altele/1/nope">Ignore</a></div>
  `);
  const positiveNamespaceDocument = getDocument(`
    <header><a href="https://www.pbinfo.ro/utilizator/12/header-user">Header User</a></header>
  `);
  assert.equal(detectPbinfoUserNamespace(mixedNamespaceDocument), null);
  assert.equal(detectPbinfoUserNamespace(positiveNamespaceDocument), '12:header-user');
  assert.equal(detectPbinfoUserNamespace(null), null);
});
