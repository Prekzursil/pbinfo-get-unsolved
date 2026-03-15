const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseRetryAfterMs,
  createParsedCacheEntry,
  isParsedCacheEntryFresh,
  createOutcomeLedger,
  recordOutcomeEntry,
  summarizeOutcomeLedger,
  listRetryableOutcomeKeys,
  listRetryableOutcomeEntries,
  filterProblemsByQuality,
  buildResultsExportPayload,
  applyVerifiedScoreToProblem,
  createNavigationState,
  pickNextNavigationProblem,
  pickRandomNavigationProblem,
  buildProgressText,
} = require('../src/core');

test('parseRetryAfterMs: supports seconds, HTTP date, and invalid values', () => {
  const now = Date.UTC(2026, 2, 9, 12, 0, 0);

  assert.equal(parseRetryAfterMs('37', now), 37_000);
  assert.equal(parseRetryAfterMs(' Mon, 09 Mar 2026 12:00:15 GMT ', now), 15_000);
  assert.equal(parseRetryAfterMs('not-a-date', now), null);
  assert.equal(parseRetryAfterMs('', now), null);
});

test('outcome ledger: tracks latest state, retries, averages, and retryable keys', () => {
  const ledger = createOutcomeLedger();
  recordOutcomeEntry(ledger, {
    targetType: 'list-page',
    targetKey: '5',
    status: 'timeout',
    retryCount: 1,
    durationMs: 800,
  });
  recordOutcomeEntry(ledger, {
    targetType: 'list-page',
    targetKey: '5',
    status: 'success',
    retryCount: 2,
    durationMs: 300,
  });
  recordOutcomeEntry(ledger, {
    targetType: 'list-page',
    targetKey: '6',
    status: 'blocked',
    retryCount: 1,
    durationMs: 1200,
  });
  recordOutcomeEntry(ledger, {
    targetType: 'verify-problem',
    targetKey: '42',
    status: 'parse-fail',
    retryCount: 0,
    durationMs: 100,
  });

  const summary = summarizeOutcomeLedger(ledger);
  assert.equal(summary.total, 3);
  assert.equal(summary.success, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.parseFail, 1);
  assert.equal(summary.timeout, 0);
  assert.equal(summary.retryCount, 3);
  assert.equal(summary.unknowns, 2);
  assert.equal(summary.avgDurationMs, 533);

  assert.deepEqual(listRetryableOutcomeKeys(ledger), ['list-page:6', 'verify-problem:42']);
  assert.deepEqual(
    listRetryableOutcomeEntries(ledger).map((entry) => entry.key),
    ['list-page:6', 'verify-problem:42']
  );
});

test('buildResultsExportPayload: wraps problems with coverage, reliability, settings, and verification metadata', () => {
  const payload = buildResultsExportPayload(
    [
      {
        id: 7,
        name: 'sum',
        link: 'https://www.pbinfo.ro/probleme/7/sum',
        status: 'tried',
        quality: 'scan-only',
        verifiedAt: 123456789,
        userScore: 70,
        maxScore: 100,
        difficulty: 0,
        postedBy_name: 'mentor',
        postedBy_link: 'https://www.pbinfo.ro/utilizator/1/mentor',
        author: 'Author',
        source: 'Source',
      },
    ],
    {
      source: {
        scanMode: 'list',
        pageLink: 'https://www.pbinfo.ro/?pagina=probleme-lista&tag=1',
      },
      settings: {
        speedPreset: 'balanced',
        verifyUnsolved: true,
      },
      coverage: {
        scannedPages: 12,
        expectedPages: 15,
        scannedProblems: 120,
        totalProblems: 150,
        percent: 80,
      },
      reliability: {
        retryCount: 4,
        blocked: 1,
        timeout: 2,
        parseFail: 0,
      },
      verification: {
        enabled: true,
        verifiedUnsolved: 1,
        reclassifiedSolved: 0,
        stillUnknown: 0,
      },
    }
  );

  assert.equal(payload.type, 'pbinfo-get-unsolved-results');
  assert.equal(payload.exportVersion, 1);
  assert.equal(payload.source.scanMode, 'list');
  assert.equal(payload.settings.verifyUnsolved, true);
  assert.equal(payload.coverage.expectedPages, 15);
  assert.equal(payload.reliability.retryCount, 4);
  assert.equal(payload.verification.verifiedUnsolved, 1);
  assert.equal(payload.problems.length, 1);
  assert.equal(payload.problems[0].id, 7);
  assert.equal(payload.problems[0].quality, 'scan-only');
  assert.equal(payload.problems[0].verifiedAt, 123456789);
});

test('applyVerifiedScoreToProblem: reclassifies solved, confirms unsolved, and preserves unknown verification', () => {
  const tried = {
    id: 8,
    name: 'demo',
    link: 'https://www.pbinfo.ro/probleme/8/demo',
    status: 'tried',
    userScore: 70,
    maxScore: 100,
    score: 70,
    scoreKnown: true,
  };

  const solvedResult = applyVerifiedScoreToProblem(tried, { userScore: 100, maxScore: 100 });
  assert.equal(solvedResult.previousStatus, 'tried');
  assert.equal(solvedResult.nextStatus, 'solved');
  assert.equal(solvedResult.verificationStatus, 'reclassified-solved');
  assert.equal(solvedResult.problem.quality, 'verified');
  assert.equal(solvedResult.problem.userScore, 100);

  const unsolvedResult = applyVerifiedScoreToProblem(tried, { userScore: 40, maxScore: 100 });
  assert.equal(unsolvedResult.nextStatus, 'tried');
  assert.equal(unsolvedResult.verificationStatus, 'verified-unsolved');
  assert.equal(unsolvedResult.problem.quality, 'verified');
  assert.equal(unsolvedResult.problem.maxScore, 100);

  const unknownResult = applyVerifiedScoreToProblem(
    { ...tried, status: 'unattempted', userScore: null, scoreKnown: false, score: -1 },
    { userScore: null, maxScore: null }
  );
  assert.equal(unknownResult.nextStatus, 'unattempted');
  assert.equal(unknownResult.verificationStatus, 'unknown');
  assert.equal(unknownResult.problem.scoreKnown, false);
  assert.equal(unknownResult.problem.quality, 'verification-unknown');

  const defaultMaxScoreResult = applyVerifiedScoreToProblem(
    { id: 9, status: 'tried', userScore: 5, maxScore: null },
    { userScore: 20, maxScore: null }
  );
  assert.equal(defaultMaxScoreResult.nextStatus, 'tried');
  assert.equal(defaultMaxScoreResult.problem.maxScore, 100);
});

test('parsed cache helpers: enforce ttl, user namespace, and force-refresh bypass', () => {
  const entry = createParsedCacheEntry({
    cacheKind: 'verify-problem',
    cacheKey: '42',
    userNamespace: '321:demo-user',
    value: { userScore: 100, maxScore: 100 },
    now: 1_000,
    ttlMs: 15_000,
  });

  assert.equal(entry.cachedAt, 1_000);
  assert.equal(entry.expiresAt, 16_000);
  assert.equal(
    isParsedCacheEntryFresh(entry, {
      now: 10_000,
      userNamespace: '321:demo-user',
      forceRefresh: false,
      cacheKind: 'verify-problem',
      cacheKey: '42',
    }),
    true
  );
  assert.equal(
    isParsedCacheEntryFresh(entry, {
      now: 20_000,
      userNamespace: '321:demo-user',
      forceRefresh: false,
      cacheKind: 'verify-problem',
      cacheKey: '42',
    }),
    false
  );
  assert.equal(
    isParsedCacheEntryFresh(entry, {
      now: 10_000,
      userNamespace: 'other-user',
      forceRefresh: false,
      cacheKind: 'verify-problem',
      cacheKey: '42',
    }),
    false
  );
  assert.equal(
    isParsedCacheEntryFresh(entry, {
      now: 10_000,
      userNamespace: '321:demo-user',
      forceRefresh: true,
      cacheKind: 'verify-problem',
      cacheKey: '42',
    }),
    false
  );
});

test('filterProblemsByQuality: applies separate quality dimension without changing status', () => {
  const problems = [
    { id: 1, status: 'tried', quality: 'scan-only' },
    { id: 2, status: 'tried', quality: 'verified' },
    { id: 3, status: 'unattempted', quality: 'verification-unknown' },
  ];

  assert.deepEqual(
    filterProblemsByQuality(problems, new Set(['verified'])).map((problem) => problem.id),
    [2]
  );
  assert.deepEqual(
    filterProblemsByQuality(problems, new Set(['scan-only', 'verification-unknown'])).map(
      (problem) => problem.id
    ),
    [1, 3]
  );
  assert.equal(filterProblemsByQuality(problems, new Set(['all'])).length, 3);
});

test('navigation helpers: next is deterministic and random avoids repeats until bag exhaustion', () => {
  const problems = [
    { id: 1, status: 'tried', quality: 'scan-only' },
    { id: 2, status: 'solved', quality: 'verified' },
    { id: 3, status: 'unattempted', quality: 'verified' },
    { id: 4, status: 'tried', quality: 'scan-only' },
  ];
  const visible = [problems[0], problems[2]];
  const navState = createNavigationState();

  const nextVisibleA = pickNextNavigationProblem(navState, {
    scope: 'visible',
    visibleProblems: visible,
    allProblems: problems,
  });
  const nextVisibleB = pickNextNavigationProblem(navState, {
    scope: 'visible',
    visibleProblems: visible,
    allProblems: problems,
  });
  const nextAll = pickNextNavigationProblem(navState, {
    scope: 'all',
    visibleProblems: visible,
    allProblems: problems,
  });

  assert.equal(nextVisibleA.id, 1);
  assert.equal(nextVisibleB.id, 3);
  assert.equal(nextAll.id, 1);

  const randomA = pickRandomNavigationProblem(navState, {
    scope: 'visible',
    visibleProblems: visible,
    allProblems: problems,
    rng: () => 0.9,
  });
  const randomB = pickRandomNavigationProblem(navState, {
    scope: 'visible',
    visibleProblems: visible,
    allProblems: problems,
    rng: () => 0.9,
  });

  assert.notEqual(randomA.id, randomB.id);
  assert.deepEqual(
    [randomA.id, randomB.id].sort((a, b) => a - b),
    [1, 3]
  );
});

test('navigation helpers: random scope clamps invalid rng values', () => {
  const navState = createNavigationState();
  const problems = [
    { id: 11, status: 'tried', quality: 'scan-only' },
    { id: 12, status: 'unattempted', quality: 'verified' },
  ];

  const picked = pickRandomNavigationProblem(navState, {
    scope: 'visible',
    visibleProblems: problems,
    allProblems: problems,
    rng: () => Number.NaN,
  });

  assert.equal(picked.id, 12);
});

test('buildProgressText: formats list mode progress with totals, eta, and throttle state', () => {
  const text = buildProgressText({
    scanMode: 'list',
    now: 10_000,
    startedAt: 0,
    config: { startPage: 2 },
    paused: true,
    inFlight: 3,
    stats: { pages: 4, total: 37 },
    totalPages: 8,
    totalProblems: 120,
    pageSize: 20,
    adaptiveEnabled: true,
    effectiveDelayMs: 150,
    effectiveConcurrency: 2,
  });

  assert.match(text, /^Progres: pagini 4\/7, probleme 37\/100 · timp 10s/);
  assert.match(text, /ETA ~/);
  assert.match(text, /throttle delay=150ms concurență=2/);
  assert.match(text, /pauză/);
  assert.match(text, /în lucru 3/);
  assert.match(text, /\(de la 2\)$/);
});

test('buildProgressText: formats id-range mode progress with 404 and 403 counts', () => {
  const text = buildProgressText({
    scanMode: 'id-range',
    now: 65_000,
    startedAt: 0,
    config: { startPage: 100, idRange: { endId: 109 } },
    paused: false,
    inFlight: 0,
    stats: { pages: 5, total: 3, missing: 1, forbidden: 2 },
    totalPages: null,
    totalProblems: null,
    pageSize: null,
    adaptiveEnabled: false,
    effectiveDelayMs: 0,
    effectiveConcurrency: 1,
  });

  assert.match(text, /^Progres: ID-uri 5\/10, probleme 3 \(găsite\) · 404 1 · timp 1m 05s/);
  assert.match(text, /403 2$/);
});

test('buildProgressText: uses total problems fallback when page size is unavailable', () => {
  const text = buildProgressText({
    scanMode: 'list',
    config: { startPage: 1 },
    stats: { pages: 3, total: 9 },
    totalPages: 5,
    totalProblems: 25,
    startedAt: 1_000,
    now: 10_000,
    adaptiveEnabled: false,
  });

  assert.match(text, /pagini 3\/5/);
  assert.match(text, /probleme 9\/25/);
});

test('buildProgressText: id-range progress omits total when end id is unavailable', () => {
  const text = buildProgressText({
    scanMode: 'id-range',
    config: { startPage: 200, idRange: {} },
    stats: { pages: 4, total: 2 },
    startedAt: 0,
    now: 5_000,
    adaptiveEnabled: false,
  });

  assert.match(text, /^Progres: ID-uri 4, probleme 2 \(găsite\) · timp 5s/);
  assert.doesNotMatch(text, /ID-uri 4\/\d+/);
});
