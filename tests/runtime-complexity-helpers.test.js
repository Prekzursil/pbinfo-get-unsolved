const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCoverageText,
  buildTrustMetricsView,
  buildOutcomeRetryTargets,
  resolveCacheLabel,
  resolvePauseText,
  resolveVerificationLabel,
} = require('../src/core/runtime-trust-metrics');
const {
  resolveSaveStateLevels,
  normalizeStatsSnapshot,
  normalizeVerificationSnapshot,
  normalizeFilterSnapshot,
  applyPaginationSnapshot,
  applyIdRangeSnapshot,
  applySortedSnapshot,
} = require('../src/core/runtime-state-persistence');
const { buildRuntimeConfig } = require('../src/core/runtime-config');
const {
  buildIdRangeScoreBatchRequest,
  classifyScoreBatchResponse,
  parseScoreBatchResponsePayload,
  buildPageUnitLabel,
  classifyPageFetchResponse,
} = require('../src/core/runtime-fetch-response');
const { restoreRuntimeSnapshotState } = require('../src/core/runtime-state-restore');

test('runtime complexity helpers: trust metrics model derives labels and counters', () => {
  const view = buildTrustMetricsView({
    coverage: {
      scannedPages: 3,
      expectedPages: 12,
      scannedProblems: 20,
      totalProblems: 100,
      percent: 25,
    },
    reliability: {
      retryCount: 2,
      unknowns: 5,
      blocked: 1,
      rateLimited: 1,
      timeout: 0,
      parseFail: 0,
      avgDurationMs: 222,
    },
    verification: {
      enabled: true,
      running: false,
      completed: true,
    },
    cacheConfig: {
      enabled: true,
      forceRefresh: false,
    },
    parsedCacheState: {
      persistenceEnabled: true,
      userNamespace: 'u-demo',
      hits: 17,
    },
    paused: true,
    systemPauseReason: 'rate-limit',
    systemPauseUntil: 12000,
    now: 10000,
    formatDuration(value) {
      return `${Math.ceil(value / 1000)}s`;
    },
  });

  assert.equal(view.percentText, '25%');
  assert.equal(view.coveragePagesText, '3/12');
  assert.equal(view.coverageProblemsText, '20/100');
  assert.equal(view.cacheLabel, 'on (17 hit)');
  assert.equal(view.verificationLabel, 'gata');
  assert.equal(view.pauseText, ' · pauză sistem: rate-limit (2s)');
  assert.equal(view.metricDefinitions.length, 11);
});

test('runtime complexity helpers: retry target extraction accepts supported targets only', () => {
  const targets = buildOutcomeRetryTargets([
    { targetType: ' verify-problem ', targetKey: '14' },
    { targetType: 'list-page', targetKey: 15 },
    { targetType: 'id-page', targetKey: 'abc' },
    { targetType: 'score-batch', targetKey: '16' },
    { targetType: 'other', targetKey: 17 },
    null,
  ]);

  assert.deepEqual(targets, [
    { targetType: 'verify-problem', targetKey: 14 },
    { targetType: 'list-page', targetKey: 15 },
    { targetType: 'score-batch', targetKey: 16 },
  ]);
});

test('runtime complexity helpers: trust metric fallbacks cover no-target and unknown-percent branches', () => {
  assert.equal(buildCoverageText(7, 0), '7');
  assert.equal(buildCoverageText(7, null), '7');

  const view = buildTrustMetricsView({
    coverage: {
      scannedPages: 5,
      expectedPages: 0,
      scannedProblems: 9,
      totalProblems: null,
      percent: null,
    },
    reliability: {
      retryCount: 0,
      unknowns: 0,
      blocked: 0,
      rateLimited: 0,
      timeout: 0,
      parseFail: 0,
      avgDurationMs: 1,
    },
    verification: {
      enabled: false,
      running: false,
      completed: false,
    },
    cacheConfig: {
      enabled: true,
      forceRefresh: false,
    },
    parsedCacheState: null,
    paused: true,
    systemPauseReason: 'manual',
    systemPauseUntil: null,
    now: 1000,
    formatDuration(value) {
      return `${value}ms`;
    },
  });

  assert.equal(view.coveragePagesText, '5');
  assert.equal(view.coverageProblemsText, '9');
  assert.equal(view.percentText, 'n/a');
  assert.equal(view.cacheLabel, 'waiting user');
  assert.equal(view.verificationLabel, 'off');
  assert.equal(view.pauseText, ' · pauză sistem: manual');
  assert.deepEqual(buildOutcomeRetryTargets(null), []);

  assert.match(
    resolvePauseText({
      paused: true,
      systemPauseReason: 'rate-limit',
      systemPauseUntil: 2200,
      now: 1200,
    }),
    /\(1000ms\)/
  );
});

test('runtime complexity helpers: save-state level selection honors progress-only fallback', () => {
  assert.deepEqual(resolveSaveStateLevels({ mode: 'full', progressOnly: false }), [
    'full',
    'minimal',
    'progress',
  ]);
  assert.deepEqual(resolveSaveStateLevels({ mode: 'full', progressOnly: true }), [
    'minimal',
    'progress',
  ]);
  assert.deepEqual(resolveSaveStateLevels({ mode: 'minimal', progressOnly: false }), [
    'minimal',
    'progress',
  ]);
  assert.deepEqual(resolveSaveStateLevels({ mode: 'progress', progressOnly: false }), ['progress']);
});

test('runtime complexity helpers: snapshot normalizers apply defensive defaults', () => {
  assert.deepEqual(normalizeStatsSnapshot({ solved: 1, tried: 2, total: 4 }), {
    solved: 1,
    tried: 2,
    unattempted: 0,
    total: 4,
    pages: 0,
    missing: 0,
    forbidden: 0,
  });
  assert.deepEqual(normalizeVerificationSnapshot({ enabled: true, attempted: 3 }), {
    enabled: true,
    running: false,
    completed: false,
    attempted: 3,
    verifiedUnsolved: 0,
    reclassifiedSolved: 0,
    stillUnknown: 0,
  });
  assert.deepEqual(normalizeFilterSnapshot({ statuses: ['solved'], searchQuery: 123 }), {
    statuses: ['solved'],
    qualities: ['all'],
    includeUnknownScore: false,
    scoreMin: null,
    scoreMax: null,
    searchQuery: '',
  });
});

test('runtime complexity helpers: pagination/id-range/sorted snapshot appliers mutate targets safely', () => {
  const pagination = {
    mode: 'offset',
    param: 'start',
    pageBase: 1,
  };
  applyPaginationSnapshot(pagination, {
    mode: 'page',
    param: 'p',
    pageBase: 10,
  });
  assert.deepEqual(pagination, {
    mode: 'page',
    param: 'p',
    pageBase: 10,
  });

  const idRange = {
    startId: 1,
    endId: 8000,
    stopAfterMissing: 0,
    scoreBatch: {
      enabled: true,
      size: 200,
    },
  };
  applyIdRangeSnapshot(idRange, {
    startId: 22,
    endId: 99,
    stopAfterMissing: 5,
    scoreBatch: {
      enabled: false,
      size: 50,
    },
  });
  assert.deepEqual(idRange, {
    startId: 22,
    endId: 99,
    stopAfterMissing: 5,
    scoreBatch: {
      enabled: false,
      size: 50,
    },
  });

  const sorted = {
    id: 1,
    score: -1,
    difficulty: 0,
  };
  applySortedSnapshot(sorted, {
    id: -1,
    score: 1,
    difficulty: Number.NaN,
  });
  assert.deepEqual(sorted, {
    id: -1,
    score: 1,
    difficulty: 0,
  });
});

test('runtime complexity helpers: runtime config builder keeps defaults and coercions stable', () => {
  const defaults = buildRuntimeConfig({});
  assert.equal(defaults.idRange.startId, 1);
  assert.equal(defaults.idRange.endId, 8000);
  assert.equal(defaults.pagination.mode, 'offset');
  assert.equal(defaults.maxRetriesPerPage, 3);
  assert.equal(defaults.cache.ttlMs, 900000);
  assert.equal(defaults.navScope, 'visible');

  const configured = buildRuntimeConfig({
    PBINFO_GET_UNSOLVED_ID_START: '11',
    PBINFO_GET_UNSOLVED_ID_END: '22',
    PBINFO_GET_UNSOLVED_DELAY_MS: '150',
    PBINFO_GET_UNSOLVED_MAX_RETRIES: '7',
    PBINFO_GET_UNSOLVED_NAV_SCOPE: 'all',
  });
  assert.equal(configured.idRange.startId, 11);
  assert.equal(configured.idRange.endId, 22);
  assert.equal(configured.delayMs, 150);
  assert.equal(configured.maxRetriesPerPage, 7);
  assert.equal(configured.navScope, 'all');
});

test('runtime complexity helpers: score batch request builder and payload parser normalize runtime inputs', () => {
  assert.deepEqual(buildIdRangeScoreBatchRequest({ batchStart: 10, size: 3, endId: 13 }), {
    batchEnd: 12,
    ids: [10, 11, 12],
    cacheKey: '10-12',
  });
  assert.equal(buildIdRangeScoreBatchRequest({ batchStart: 10, size: 0, endId: 20 }), null);

  const parsedScores = parseScoreBatchResponsePayload({
    responseText: JSON.stringify({
      data: [
        { id_problema: '11', scor: '42' },
        { id_problema: '12', scor: '-' },
        { id_problema: 'x', scor: '55' },
      ],
    }),
    parseScoreValue(raw) {
      if (raw === '-') return { value: null, raw: '-' };
      return { value: Number.parseInt(raw, 10), raw };
    },
  });
  assert.deepEqual(parsedScores, [
    { id: 11, raw: '42', value: 42 },
    { id: 12, raw: '-', value: null },
  ]);
});

test('runtime complexity helpers: page/score response classifiers cover primary runtime branches', () => {
  assert.equal(
    classifyScoreBatchResponse({
      status: 429,
      responseText: 'limited',
      isBlockedHtml: () => false,
    }),
    'rate-limited'
  );
  assert.equal(
    classifyScoreBatchResponse({
      status: 200,
      responseText: 'challenge',
      isBlockedHtml: () => true,
    }),
    'blocked'
  );

  assert.equal(buildPageUnitLabel('list', 2), 'pagina 2');
  assert.equal(buildPageUnitLabel('id-range', 99), 'ID 99');
  assert.equal(
    classifyPageFetchResponse({
      scanMode: 'id-range',
      status: 404,
      responseText: '<html></html>',
      isBlockedHtml: () => false,
      isNotFoundHtml: () => false,
    }),
    'id-range-missing'
  );
  assert.equal(
    classifyPageFetchResponse({
      scanMode: 'list',
      status: 200,
      responseText: 'Invalid request',
      isBlockedHtml: () => false,
      isNotFoundHtml: () => false,
    }),
    'invalid-request'
  );
});

test('runtime complexity helpers: response and request helpers cover defensive branches', () => {
  assert.equal(buildIdRangeScoreBatchRequest({ batchStart: Number.NaN, size: 3, endId: 30 }), null);
  assert.equal(buildIdRangeScoreBatchRequest({ batchStart: 10, size: 3, endId: Number.NaN }), null);
  assert.equal(buildIdRangeScoreBatchRequest({ batchStart: 10, size: -1, endId: 30 }), null);
  assert.equal(buildIdRangeScoreBatchRequest({ batchStart: 10, size: 3, endId: 9 }), null);

  assert.equal(
    classifyScoreBatchResponse({
      status: 500,
      responseText: 'oops',
      isBlockedHtml: () => false,
    }),
    'http-error'
  );
  assert.equal(
    classifyScoreBatchResponse({
      status: 200,
      responseText: 'ok',
    }),
    'success'
  );
  assert.equal(
    classifyScoreBatchResponse({
      status: 200,
      responseText: 'ok',
      isBlockedHtml: () => false,
    }),
    'success'
  );

  assert.deepEqual(
    parseScoreBatchResponsePayload({ responseText: '{', parseScoreValue: null }),
    []
  );
  assert.deepEqual(parseScoreBatchResponsePayload({ responseText: '{}' }), []);
  assert.deepEqual(
    parseScoreBatchResponsePayload({
      responseText: {
        data: [
          { id_problema: '21', scor: null },
          { id_problema: '22', scor: 9 },
        ],
      },
    }),
    [
      { id: 21, raw: '-', value: null },
      { id: 22, raw: '9', value: null },
    ]
  );
  assert.deepEqual(
    parseScoreBatchResponsePayload({
      responseText: {
        data: [{ id_problema: '23', scor: '15' }],
      },
      parseScoreValue(raw) {
        return { raw: 15, value: Number.parseInt(raw, 10) };
      },
    }),
    [{ id: 23, raw: '15', value: 15 }]
  );

  assert.equal(
    classifyPageFetchResponse({
      scanMode: 'list',
      status: 429,
      responseText: '<html/>',
      isBlockedHtml: () => false,
      isNotFoundHtml: () => false,
    }),
    'rate-limited'
  );

  assert.equal(
    classifyPageFetchResponse({
      scanMode: 'list',
      status: 200,
      responseText: '<challenge>',
      isBlockedHtml: () => true,
      isNotFoundHtml: () => false,
    }),
    'blocked'
  );
  assert.equal(
    classifyPageFetchResponse({
      scanMode: 'id-range',
      status: 200,
      responseText: '<not-found>',
      isBlockedHtml: () => false,
      isNotFoundHtml: () => true,
    }),
    'id-range-missing'
  );
  assert.equal(
    classifyPageFetchResponse({
      scanMode: 'id-range',
      status: 403,
      responseText: '<html/>',
      isBlockedHtml: () => false,
      isNotFoundHtml: () => false,
    }),
    'id-range-forbidden'
  );
  assert.equal(
    classifyPageFetchResponse({
      scanMode: 'list',
      status: 500,
      responseText: '<html/>',
      isBlockedHtml: () => false,
      isNotFoundHtml: () => false,
    }),
    'http-error'
  );
  assert.equal(
    classifyPageFetchResponse({
      scanMode: 'list',
      status: 200,
      responseText: '<html/>',
      isBlockedHtml: () => false,
      isNotFoundHtml: () => false,
    }),
    'success'
  );
  assert.equal(
    classifyPageFetchResponse({
      scanMode: 'list',
      status: 200,
      responseText: '<html/>',
    }),
    'success'
  );
  assert.equal(
    classifyPageFetchResponse({
      scanMode: 'id-range',
      status: 200,
      responseText: '<html/>',
    }),
    'success'
  );
});

test('runtime complexity helpers: config and trust label helpers cover fallback branches', () => {
  const configured = buildRuntimeConfig({
    PBINFO_GET_UNSOLVED_PAGE_SIZE: '42',
    PBINFO_GET_UNSOLVED_NAV_SCOPE: 'not-all',
    PBINFO_GET_UNSOLVED_CACHE_ENABLED: false,
    PBINFO_GET_UNSOLVED_FORCE_REFRESH: true,
  });
  assert.equal(configured.pageSize, 42);
  assert.equal(configured.navScope, 'visible');
  assert.equal(configured.cache.enabled, false);
  assert.equal(configured.cache.forceRefresh, true);

  assert.equal(resolveCacheLabel({ enabled: false }, { persistenceEnabled: true, hits: 1 }), 'off');
  assert.equal(resolveCacheLabel({ enabled: true, forceRefresh: true }, {}), 'force-refresh');
  assert.equal(
    resolveCacheLabel({ enabled: true, forceRefresh: false }, { userNamespace: 'u' }),
    'memory only'
  );
  assert.equal(resolveCacheLabel({ enabled: true, forceRefresh: false }, {}), 'waiting user');

  assert.equal(resolvePauseText({ paused: false, systemPauseReason: 'rate-limit' }), '');
  assert.equal(resolvePauseText({ paused: true, systemPauseReason: '', systemPauseUntil: 0 }), '');
  assert.match(
    resolvePauseText({
      paused: true,
      systemPauseReason: 'blocked',
      systemPauseUntil: 1000,
      now: 500,
      formatDuration: (value) => `${value}ms`,
    }),
    /pauză sistem: blocked/
  );
  assert.equal(resolveVerificationLabel({ enabled: false }), 'off');
  assert.equal(resolveVerificationLabel({ enabled: true, running: true }), 'rulează');
  assert.equal(
    resolveVerificationLabel({ enabled: true, running: false, completed: false }),
    'pregătită'
  );
});

test('runtime complexity helpers: persistence snapshot appliers handle invalid and partial inputs', () => {
  const pagination = { mode: 'offset', param: 'start', pageBase: 1 };
  applyPaginationSnapshot(pagination, null);
  assert.deepEqual(pagination, { mode: 'offset', param: 'start', pageBase: 1 });

  const idRange = {
    startId: 1,
    endId: 2,
    stopAfterMissing: 0,
    scoreBatch: { enabled: true, size: 5 },
  };
  applyIdRangeSnapshot(idRange, null);
  assert.deepEqual(idRange, {
    startId: 1,
    endId: 2,
    stopAfterMissing: 0,
    scoreBatch: { enabled: true, size: 5 },
  });
  applyIdRangeSnapshot(idRange, { startId: 10, scoreBatch: null });
  assert.equal(idRange.startId, 10);
  assert.equal(idRange.scoreBatch.enabled, true);
  assert.equal(idRange.scoreBatch.size, 5);

  const sorted = { id: 0, score: 0 };
  applySortedSnapshot(sorted, null);
  assert.deepEqual(sorted, { id: 0, score: 0 });

  assert.deepEqual(
    normalizeFilterSnapshot({ statuses: ['bad'], qualities: ['bad'], includeUnknownScore: 1 }),
    {
      statuses: ['tried', 'unattempted'],
      qualities: ['all'],
      includeUnknownScore: true,
      scoreMin: null,
      scoreMax: null,
      searchQuery: '',
    }
  );
});

test('runtime complexity helpers: runtime-state-restore rehydrates and applies snapshot payload', () => {
  const activeRequests = new Set([
    { abort() {} },
    {
      abort() {
        throw new Error('abort failed');
      },
    },
    { abort: null },
  ]);
  const activePageIndexes = new Set([1, 2]);
  let inFlight = 7;
  let stopRequested = false;
  let paused = false;
  let scanEnd = null;
  let startedAt = 0;
  let pageSize = 10;
  let totalProblems = 0;
  let totalPages = 0;
  let queueInitialized = false;
  let nextSequentialPage = null;
  let finished = false;
  const config = {
    pagination: { mode: 'offset', param: 'start', pageBase: 1 },
    idRange: {
      startId: 1,
      endId: 100,
      stopAfterMissing: 0,
      scoreBatch: { enabled: true, size: 5 },
    },
    cache: { enabled: true, ttlMs: 1000, forceRefresh: false },
    startPage: 1,
  };
  const stats = {};
  const allProblems = [];
  const seenProblemIds = new Set();
  const outcomeLedger = { entries: { stale: { status: 'timeout' } } };
  const verificationState = {};
  const filterState = {
    statuses: new Set(['solved']),
    qualities: new Set(['all']),
    includeUnknownScore: false,
    scoreMin: null,
    scoreMax: null,
    searchQuery: '',
  };
  const sorted = { id: 0, score: 0, difficulty: 0 };
  const pageQueue = [999];
  const deferredPageRequests = new Map([[999, 3]]);
  const deferredCalls = [];
  let setupControlsCalls = 0;
  let ensured = 0;
  let rendered = 0;
  let progressArg = null;
  const logs = [];
  const pauseButton = { textContent: '', disabled: false };
  const stopButton = { disabled: false };
  let refreshCacheCalls = 0;

  const migrated = {
    stopRequested: true,
    paused: true,
    end: { finished: false },
    pagination: { mode: 'page', param: 'p', pageBase: 2 },
    idRange: {
      startId: 11,
      endId: 22,
      stopAfterMissing: 2,
      scoreBatch: { enabled: false, size: 3 },
    },
    scanStartPage: 4,
    elapsedMs: 200,
    pageSize: 25,
    totalProblems: 100,
    totalPages: 10,
    stats: { solved: 1, tried: 2, unattempted: 3, total: 6, pages: 7, missing: 8, forbidden: 9 },
    problems: [
      {
        id: 7,
        name: 'P7',
        link: '/p7',
        difficulty: 1,
        status: 'tried',
        userScore: 30,
        maxScore: 100,
      },
    ],
    seenProblemIds: [7, '8'],
    outcomes: [{ targetType: 'list-page', targetKey: 3, status: 'timeout' }],
    verification: { enabled: true, completed: true, attempted: 2, verifiedUnsolved: 1 },
    cachePolicy: { enabled: false, ttlMs: 5000, forceRefresh: true },
    filters: {
      statuses: ['solved'],
      qualities: ['verified'],
      includeUnknownScore: true,
      scoreMin: 1,
      scoreMax: 99,
      searchQuery: 'abc',
    },
    sorted: { id: 1, score: -1, difficulty: 2 },
    queueInitialized: true,
    pageQueue: [10, 'bad'],
    deferred: [
      [12, 1],
      ['x', 9],
    ],
    nextSequentialPage: 13,
    inFlightPages: [14],
    storageLevel: 'progress',
  };

  const restored = restoreRuntimeSnapshotState({
    migrated,
    kind: 'minimal',
    scanMode: 'id-range',
    activeRequests,
    activePageIndexes,
    setInFlight(value) {
      inFlight = value;
    },
    setStopRequested(value) {
      stopRequested = value;
    },
    setPaused(value) {
      paused = value;
    },
    setScanEnd(value) {
      scanEnd = value;
    },
    config,
    setStartedAt(value) {
      startedAt = value;
    },
    getPageSize() {
      return pageSize;
    },
    setPageSize(value) {
      pageSize = value;
    },
    getTotalProblems() {
      return totalProblems;
    },
    setTotalProblems(value) {
      totalProblems = value;
    },
    getTotalPages() {
      return totalPages;
    },
    setTotalPages(value) {
      totalPages = value;
    },
    stats,
    allProblems,
    seenProblemIds,
    outcomeLedger,
    verificationState,
    refreshParsedCacheAvailability() {
      refreshCacheCalls += 1;
    },
    filterState,
    sorted,
    pageQueue,
    deferredPageRequests,
    setQueueInitialized(value) {
      queueInitialized = value;
    },
    setNextSequentialPage(value) {
      nextSequentialPage = value;
    },
    deferPage(pageIndex, retryCount) {
      deferredCalls.push([pageIndex, retryCount]);
    },
    setFinished(value) {
      finished = value;
    },
    setupControls() {
      setupControlsCalls += 1;
    },
    pauseButton,
    stopButton,
    ensureResultsAttached() {
      ensured += 1;
    },
    renderResults() {
      rendered += 1;
    },
    getInFlight() {
      return inFlight;
    },
    updateProgress(value) {
      progressArg = value;
    },
    addLog(message) {
      logs.push(message);
    },
  });

  assert.equal(restored, true);
  assert.equal(activeRequests.size, 0);
  assert.equal(activePageIndexes.size, 0);
  assert.equal(inFlight, 0);
  assert.equal(stopRequested, true);
  assert.equal(paused, true);
  assert.deepEqual(scanEnd, { finished: false });
  assert.equal(config.pagination.mode, 'page');
  assert.equal(config.idRange.startId, 11);
  assert.equal(config.startPage, 4);
  assert.ok(Number.isFinite(startedAt));
  assert.equal(pageSize, 25);
  assert.equal(totalProblems, 100);
  assert.equal(totalPages, 10);
  assert.equal(stats.total, 6);
  assert.equal(allProblems.length, 1);
  assert.ok(seenProblemIds.has(7));
  assert.ok(seenProblemIds.has(8));
  assert.equal(refreshCacheCalls, 1);
  assert.deepEqual([...filterState.statuses], ['solved']);
  assert.deepEqual([...filterState.qualities], ['verified']);
  assert.equal(queueInitialized, true);
  assert.deepEqual(pageQueue, [10]);
  assert.equal(deferredPageRequests.get(12), 1);
  assert.equal(nextSequentialPage, 13);
  assert.deepEqual(deferredCalls, [[14, 0]]);
  assert.equal(setupControlsCalls, 1);
  assert.equal(pauseButton.textContent, 'Continuă');
  assert.equal(stopButton.disabled, false);
  assert.equal(ensured, 1);
  assert.equal(rendered, 1);
  assert.equal(progressArg, 0);
  assert.equal(finished, false);
  assert.equal(logs.length, 1);
});

test('runtime complexity helpers: runtime-state-restore logs compact note for minimal snapshots', () => {
  const logs = [];
  restoreRuntimeSnapshotState({
    migrated: {
      end: { finished: true },
      storageLevel: 'minimal',
      stats: {},
    },
    kind: 'minimal',
    scanMode: 'list',
    activeRequests: new Set(),
    activePageIndexes: new Set(),
    setInFlight() {},
    setStopRequested() {},
    setPaused() {},
    setScanEnd() {},
    config: {
      pagination: { mode: 'offset', param: 'start', pageBase: 1 },
      idRange: {
        startId: 1,
        endId: 2,
        stopAfterMissing: 0,
        scoreBatch: { enabled: true, size: 1 },
      },
      cache: { enabled: true, ttlMs: 1000, forceRefresh: false },
    },
    setStartedAt() {},
    getPageSize() {
      return 10;
    },
    setPageSize() {},
    getTotalProblems() {
      return 0;
    },
    setTotalProblems() {},
    getTotalPages() {
      return 0;
    },
    setTotalPages() {},
    stats: {},
    allProblems: [],
    seenProblemIds: new Set(),
    outcomeLedger: { entries: {} },
    verificationState: {},
    refreshParsedCacheAvailability() {},
    filterState: {
      statuses: new Set(['tried']),
      qualities: new Set(['all']),
      includeUnknownScore: false,
      scoreMin: null,
      scoreMax: null,
      searchQuery: '',
    },
    sorted: { id: 0, score: 0, difficulty: 0 },
    pageQueue: [],
    deferredPageRequests: new Map(),
    setQueueInitialized() {},
    setNextSequentialPage() {},
    deferPage() {},
    setFinished() {},
    setupControls() {},
    pauseButton: null,
    stopButton: null,
    ensureResultsAttached() {},
    renderResults() {},
    getInFlight() {
      return 0;
    },
    updateProgress() {},
    addLog(message) {
      logs.push(message);
    },
  });

  assert.equal(logs.length, 1);
  assert.match(logs[0], /compact/);
});

test('runtime complexity helpers: runtime-state-restore fallback branches keep defaults and resume cursor', () => {
  let scanEnd = 'unset';
  let pageSize = 10;
  let totalProblems = 20;
  let totalPages = 3;
  let nextSequentialPage = null;
  const pauseButton = { textContent: '', disabled: false };
  const stopButton = { disabled: false };
  const config = {
    pagination: { mode: 'offset', param: 'start', pageBase: 1 },
    idRange: { startId: 1, endId: 2, stopAfterMissing: 0, scoreBatch: { enabled: true, size: 1 } },
    cache: { enabled: false, ttlMs: 999, forceRefresh: true },
  };

  restoreRuntimeSnapshotState({
    migrated: {
      end: 'invalid',
      paused: false,
      elapsedMs: -5,
      cachePolicy: {
        enabled: true,
        ttlMs: 'bad',
        forceRefresh: false,
      },
      queueInitialized: false,
      resumeFromPage: 55,
      outcomes: null,
      pageQueue: null,
      deferred: null,
      inFlightPages: null,
      stats: null,
      verification: null,
      filters: null,
      sorted: null,
    },
    kind: 'full',
    scanMode: 'list',
    activeRequests: new Set(),
    activePageIndexes: new Set(),
    setInFlight() {},
    setStopRequested() {},
    setPaused() {},
    setScanEnd(value) {
      scanEnd = value;
    },
    config,
    setStartedAt() {},
    getPageSize() {
      return pageSize;
    },
    setPageSize(value) {
      pageSize = value;
    },
    getTotalProblems() {
      return totalProblems;
    },
    setTotalProblems(value) {
      totalProblems = value;
    },
    getTotalPages() {
      return totalPages;
    },
    setTotalPages(value) {
      totalPages = value;
    },
    stats: {},
    allProblems: [],
    seenProblemIds: new Set(),
    outcomeLedger: { entries: null },
    verificationState: {},
    refreshParsedCacheAvailability() {},
    filterState: {
      statuses: new Set(['tried']),
      qualities: new Set(['all']),
      includeUnknownScore: false,
      scoreMin: null,
      scoreMax: null,
      searchQuery: '',
    },
    sorted: { id: 0, score: 0, difficulty: 0 },
    pageQueue: [],
    deferredPageRequests: new Map(),
    setQueueInitialized() {},
    setNextSequentialPage(value) {
      nextSequentialPage = value;
    },
    deferPage() {},
    setFinished() {},
    setupControls() {},
    pauseButton,
    stopButton,
    ensureResultsAttached() {},
    renderResults() {},
    getInFlight() {
      return 0;
    },
    updateProgress() {},
    addLog() {},
  });

  assert.equal(scanEnd, null);
  assert.equal(config.cache.enabled, true);
  assert.equal(config.cache.ttlMs, 999);
  assert.equal(config.cache.forceRefresh, false);
  assert.equal(pageSize, 10);
  assert.equal(totalProblems, 20);
  assert.equal(totalPages, 3);
  assert.equal(nextSequentialPage, 55);
  assert.equal(pauseButton.textContent, 'Pauză');
  assert.equal(pauseButton.disabled, false);
  assert.equal(stopButton.disabled, false);
});
