'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSpace,
  normalizeForMatch,
  parseScoreText,
  selectScoreFromCandidates,
  getTooltipText,
  buildScoreCandidatesFromCard,
  extractScoreInfoFromCard,
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
  migrateStateSnapshotToV2,
  extractSnapshotFromImport,
  problemsToCsv,
  problemsToLinksText,
  problemsToIdsText,
  problemsToMarkdownText,
  serializeProblemForSnapshot,
  computeResumeFromStateSnapshot,
  restoreProblemsFromSnapshot,
} = require('../pbinfo-get-unsolved-enhanced.js');

test('normalizeSpace: null and empty inputs fall through to empty string', () => {
  assert.equal(normalizeSpace(null), '');
  assert.equal(normalizeSpace(undefined), '');
  assert.equal(normalizeSpace(''), '');
  assert.equal(normalizeSpace('   a \n  b\t  '), 'a b');
  assert.equal(normalizeSpace(42), '42');
});

test('normalizeForMatch: strips diacritics and lowercases', () => {
  assert.equal(normalizeForMatch('ȘtefănĂ Țara'), 'stefana tara');
  assert.equal(normalizeForMatch(null), '');
});

test('parseScoreText: empty, unparseable, and number-only inputs', () => {
  assert.equal(parseScoreText(''), null);
  assert.equal(parseScoreText('not a number'), null);
  assert.deepEqual(parseScoreText('42'), { value: 42, max: null, hasRatio: false });
});

test('selectScoreFromCandidates: empty list returns null scores', () => {
  assert.deepEqual(selectScoreFromCandidates([]), { userScore: null, maxScore: null });
});

test('selectScoreFromCandidates: scor maxim keyword path', () => {
  const res = selectScoreFromCandidates([
    { tooltip: 'scor maxim', text: '75p', value: 75, max: null, hasRatio: false, isLink: false },
  ]);
  assert.deepEqual(res, { userScore: null, maxScore: 75 });
});

test('selectScoreFromCandidates: non-finite best.value is rejected', () => {
  const res = selectScoreFromCandidates([
    { tooltip: 'Punctaj', text: 'x', value: NaN, max: null, hasRatio: false, isLink: false },
  ]);
  assert.deepEqual(res, { userScore: null, maxScore: null });
});

test('selectScoreFromCandidates: isLink bumps rank', () => {
  const res = selectScoreFromCandidates([
    { tooltip: '', text: '10p', value: 10, max: null, hasRatio: false, isLink: false },
    { tooltip: '', text: '20p', value: 20, max: null, hasRatio: false, isLink: true },
  ]);
  assert.equal(res.userScore, 20);
});

test('getTooltipText: returns first truthy attr; empty when none/missing', () => {
  const el = {
    getAttribute: (attr) => {
      if (attr === 'title') return null;
      if (attr === 'data-bs-title') return 'hello';
      return null;
    },
  };
  assert.equal(getTooltipText(el), 'hello');
  const emptyEl = { getAttribute: () => null };
  assert.equal(getTooltipText(emptyEl), '');
  assert.equal(getTooltipText({}), '');
  const fallthroughEl = {
    getAttribute: (attr) => (attr === 'data-original-title' ? 'last' : null),
  };
  assert.equal(getTooltipText(fallthroughEl), 'last');
});

test('classifyProblemStatus: handles missing scoreInfo and tie at max', () => {
  assert.equal(classifyProblemStatus(null), 'unattempted');
  assert.equal(classifyProblemStatus({}), 'unattempted');
  assert.equal(classifyProblemStatus({ userScore: 50, maxScore: 100 }), 'tried');
  assert.equal(classifyProblemStatus({ userScore: 100, maxScore: 100 }), 'solved');
  assert.equal(classifyProblemStatus({ userScore: 200, maxScore: 100 }), 'solved');
  assert.equal(classifyProblemStatus({ userScore: 0, maxScore: 100 }), 'tried');
  assert.equal(classifyProblemStatus({ userScore: 50 }), 'tried');
});

test('isLikelyPbinfoNotFoundHtml: ASCII, diacritic, and 404 variants', () => {
  assert.equal(isLikelyPbinfoNotFoundHtml('<p>Pagina nu exista</p>'), true);
  assert.equal(isLikelyPbinfoNotFoundHtml('<p>Pagina nu există</p>'), true);
  assert.equal(isLikelyPbinfoNotFoundHtml('<h1> 404  not found</h1>'), true);
  assert.equal(isLikelyPbinfoNotFoundHtml('hello world'), false);
  assert.equal(isLikelyPbinfoNotFoundHtml(null), false);
  assert.equal(isLikelyPbinfoNotFoundHtml(undefined), false);
});

test('isLikelyPbinfoBlockedHtml: detects cloudflare and generic security challenges', () => {
  assert.equal(isLikelyPbinfoBlockedHtml('script src="/cdn-cgi/challenge-platform/abc"'), true);
  assert.equal(isLikelyPbinfoBlockedHtml('<div class="cf-chl-opt">ok</div>'), true);
  assert.equal(isLikelyPbinfoBlockedHtml('<h1>Attention Required!</h1>'), true);
  assert.equal(isLikelyPbinfoBlockedHtml('<h1>Security Check</h1>'), true);
  assert.equal(isLikelyPbinfoBlockedHtml('<p>all good</p>'), false);
  assert.equal(isLikelyPbinfoBlockedHtml(null), false);
});

test('parseTotalProblems: extracts number or returns null', () => {
  assert.equal(parseTotalProblems('<span class="numar_probleme">1234</span>'), 1234);
  assert.equal(parseTotalProblems('<span class="something numar_probleme other">  42 </span>'), 42);
  assert.equal(parseTotalProblems('<span>no counter here</span>'), null);
  assert.equal(parseTotalProblems(null), null);
});

test('normalizeListUrl: null inputs, invalid URL, base-only fallback', () => {
  assert.equal(normalizeListUrl(null, null), null);
  assert.equal(normalizeListUrl('not a url', ''), null);
  assert.equal(
    normalizeListUrl('', 'https://www.pbinfo.ro/?pagina=probleme-lista&start=30', 'start'),
    'https://www.pbinfo.ro/?pagina=probleme-lista'
  );
});

test('buildPageUrl: null base returns null; default size when pageSize missing', () => {
  assert.equal(buildPageUrl(null, { pageIndex: 1 }), null);
  const def = buildPageUrl('https://www.pbinfo.ro/?pagina=probleme-lista', {
    pageIndex: 2,
  });
  assert.equal(def, 'https://www.pbinfo.ro/?pagina=probleme-lista&start=10');
});

test('buildPageUrl: pageBase defaults to 1 when not finite', () => {
  const url = buildPageUrl('https://www.pbinfo.ro/?pagina=probleme-lista', {
    pageIndex: 4,
    mode: 'page',
    param: 'page',
    pageBase: 'x',
  });
  assert.equal(url, 'https://www.pbinfo.ro/?pagina=probleme-lista&page=4');
});

test('computeBackoffWithJitter: handles non-finite attempt and defaults', () => {
  assert.equal(computeBackoffWithJitter('x', { jitter: false }), 500);
  assert.equal(computeBackoffWithJitter(-5, { jitter: false }), 500);
  assert.equal(computeBackoffWithJitter(2, { baseMs: 'x', capMs: 'x', jitter: false }), 2000);
});

test('computeBackoffWithJitter: clamps NaN random to safe default', () => {
  const v = computeBackoffWithJitter(1, {
    baseMs: 100,
    capMs: 1000,
    jitter: true,
    random: () => NaN,
  });
  assert.ok(Number.isFinite(v));
  assert.ok(v >= 0);
});

test('computeBackoffWithJitter: default random path still returns finite number', () => {
  const v = computeBackoffWithJitter(1, { baseMs: 100, capMs: 1000, jitter: true });
  assert.ok(Number.isFinite(v));
});

test('nextAdaptiveThrottleState: disabled short-circuits and sanitizes state', () => {
  const out = nextAdaptiveThrottleState(
    {
      enabled: false,
      baseDelayMs: -10,
      baseConcurrency: -5,
      delayMs: -2,
      concurrency: -1,
      cleanStreak: -3,
    },
    'success'
  );
  assert.equal(out.enabled, false);
  assert.equal(out.baseDelayMs, 0);
  assert.equal(out.baseConcurrency, 1);
  assert.equal(out.concurrency, 1);
  assert.equal(out.cleanStreak, 0);
});

test('nextAdaptiveThrottleState: success without reaching streak threshold just increments', () => {
  const out = nextAdaptiveThrottleState(
    {
      enabled: true,
      baseDelayMs: 0,
      baseConcurrency: 3,
      delayMs: 0,
      concurrency: 3,
      cleanStreak: 0,
    },
    'success'
  );
  assert.equal(out.cleanStreak, 1);
});

test('nextAdaptiveThrottleState: unknown event falls through to error branch', () => {
  const out = nextAdaptiveThrottleState(
    {
      enabled: true,
      baseDelayMs: 0,
      baseConcurrency: 3,
      delayMs: 0,
      concurrency: 3,
      cleanStreak: 5,
    },
    'timeout'
  );
  assert.equal(out.cleanStreak, 0);
  assert.equal(out.concurrency, 2);
});

test('nextAdaptiveThrottleState: non-object state is coerced safely', () => {
  const out = nextAdaptiveThrottleState(null, 'success');
  assert.equal(out.enabled, true);
  assert.equal(out.concurrency, 1);
});

test('nextAdaptiveThrottleState: blocked uses caps correctly', () => {
  const out = nextAdaptiveThrottleState(
    {
      enabled: true,
      baseDelayMs: 100,
      baseConcurrency: 4,
      delayMs: 200,
      concurrency: 4,
      cleanStreak: 1,
    },
    'blocked',
    { capMs: 'bogus' }
  );
  assert.equal(out.concurrency, 1);
  assert.ok(out.delayMs >= 1100);
});

test('migrateStateSnapshotToV2: null and non-object inputs return null', () => {
  assert.equal(migrateStateSnapshotToV2(null), null);
  assert.equal(migrateStateSnapshotToV2('foo'), null);
  assert.equal(migrateStateSnapshotToV2(42), null);
});

test('migrateStateSnapshotToV2: defaults when optional arrays missing', () => {
  const m = migrateStateSnapshotToV2({ pageLink: 'https://x' });
  assert.equal(m.storageLevel, 'progress');
  assert.deepEqual(m.pageQueue, []);
  assert.deepEqual(m.deferred, []);
  assert.deepEqual(m.inFlightPages, []);
  assert.deepEqual(m.seenProblemIds, []);
  assert.equal(m.resumeFromPage, null);
});

test('migrateStateSnapshotToV2: respects explicit storage level full', () => {
  const m = migrateStateSnapshotToV2({ storageLevel: 'full' });
  assert.equal(m.storageLevel, 'full');
});

test('migrateStateSnapshotToV2: normalizes deferred entries (array + object)', () => {
  const m = migrateStateSnapshotToV2({
    deferred: [[5, 2], { pageIndex: 7, retryCount: 1 }, ['x', 'y'], null],
  });
  assert.deepEqual(m.deferred, [
    [5, 2],
    [7, 1],
  ]);
});

test('migrateStateSnapshotToV2: savedAt fallback path', () => {
  const m = migrateStateSnapshotToV2({ savedAt: 'not a number' });
  assert.ok(Number.isFinite(m.savedAt));
});

test('extractSnapshotFromImport: plain snapshot path and strings', () => {
  assert.equal(extractSnapshotFromImport(42), null);
  const s = extractSnapshotFromImport({ pageLink: 'https://x' });
  assert.equal(s.version, 2);
});

test('csvEscape: via problemsToCsv handles missing arrays, newlines, nulls', () => {
  assert.ok(problemsToCsv(null).startsWith('\ufeffid,'));
  const csv = problemsToCsv([{ id: null, name: 'line1\nline2', status: null, link: '' }]);
  assert.ok(csv.includes('"line1\nline2"'));
});

test('problemsToLinksText / Ids / Markdown: non-array, null fields', () => {
  assert.equal(problemsToLinksText(null), '');
  assert.equal(problemsToLinksText([{ link: '  ' }, { link: 'https://a' }]), 'https://a');
  assert.equal(problemsToIdsText(null), '');
  assert.equal(problemsToIdsText([{ id: 'x' }, { id: 7 }, null]), '7');
  assert.equal(problemsToMarkdownText(null), '');
  // entry without link is skipped
  assert.equal(problemsToMarkdownText([{ id: 1, name: 'n' }]), '');
  // entry without id keeps name-only label
  assert.equal(
    problemsToMarkdownText([{ name: 'title', link: 'https://a' }]),
    '- [title](<https://a>)'
  );
  // entry without name yet with id still renders
  assert.equal(problemsToMarkdownText([{ id: 9, link: 'https://a' }]), '- [#9](<https://a>)');
});

test('serializeProblemForSnapshot: minimal vs full levels', () => {
  const p = {
    id: 1,
    name: 'x',
    link: 'https://a',
    difficulty: 2,
    status: 'tried',
    userScore: 10,
    maxScore: 100,
    postedBy_link: 'pb',
    postedBy_name: 'name',
    postedBy_img: 'img',
    author: 'auth',
    source: 'src',
  };
  const minimal = serializeProblemForSnapshot(p, 'minimal');
  assert.ok(!('postedBy_link' in minimal));
  const full = serializeProblemForSnapshot(p, 'full');
  assert.equal(full.postedBy_link, 'pb');
  assert.equal(full.author, 'auth');

  // missing fields are coerced to null for scores
  const empty = serializeProblemForSnapshot(null, 'minimal');
  assert.equal(empty.userScore, null);
  assert.equal(empty.maxScore, null);
});

test('computeResumeFromStateSnapshot: picks smallest candidate or null', () => {
  assert.equal(computeResumeFromStateSnapshot(null), null);
  assert.equal(
    computeResumeFromStateSnapshot({
      pageQueue: [5, 10],
      deferred: [[3, 1], { pageIndex: 8 }, null],
      inFlightPages: [6],
      nextSequentialPage: 12,
    }),
    3
  );
  assert.equal(computeResumeFromStateSnapshot({}), null);
});

test('restoreProblemsFromSnapshot: reconstructs problems list and seen ids', () => {
  const { allProblems, seenProblemIds } = restoreProblemsFromSnapshot({
    problems: [
      { id: 1, name: 'a', link: '/1', userScore: 100, maxScore: 100 },
      { id: 'bad' },
      { id: 2, status: 'bogus', name: 7, link: null, userScore: null },
    ],
    seenProblemIds: ['3', 'xx', 4],
  });
  assert.equal(allProblems.length, 2);
  assert.equal(allProblems[0].status, 'solved');
  assert.equal(allProblems[0].scoreKnown, true);
  assert.equal(allProblems[1].scoreKnown, false);
  assert.ok(seenProblemIds.has(1));
  assert.ok(seenProblemIds.has(2));
  assert.ok(seenProblemIds.has(3));
  assert.ok(seenProblemIds.has(4));
});

test('restoreProblemsFromSnapshot: missing input returns empty containers', () => {
  const { allProblems, seenProblemIds } = restoreProblemsFromSnapshot(null);
  assert.equal(allProblems.length, 0);
  assert.equal(seenProblemIds.size, 0);
});

test('buildScoreCandidatesFromCard / extractScoreInfoFromCard / problemPage: DOM-stub null-safety', () => {
  const emptyCard = {
    querySelectorAll: () => [],
  };
  assert.deepEqual(buildScoreCandidatesFromCard(emptyCard), []);
  const info = extractScoreInfoFromCard(emptyCard);
  assert.equal(info.userScore, null);
  assert.equal(info.maxScore, null);
  assert.ok(Array.isArray(info.candidates));

  const page = extractScoreInfoFromProblemPage({});
  assert.equal(page.userScore, null);
  assert.equal(page.maxScore, null);

  const meta = extractProblemMetaFromProblemPage({}, null);
  assert.equal(meta.difficulty, 3);
  assert.equal(meta.name, '');
});
