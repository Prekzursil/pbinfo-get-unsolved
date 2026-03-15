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
const {
  formatClipboardCopySuccessMessage,
  formatClipboardCopyErrorMessage,
  copyVisibleProblemsToClipboard,
  takeSmallestDeferredEntry,
  selectKickAction,
  isRuntimeQueueDrained,
  shouldStartVerificationPass,
  pruneSnapshotEntries,
} = require('../src/core/pbinfo-runtime');

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


test('runtime complexity helpers: pbinfo-runtime clipboard helpers format messages and guard branches', async () => {
  assert.equal(
    formatClipboardCopySuccessMessage(4, 'ID-uri', 'execCommand'),
    'Am copiat 4 ID-uri în clipboard (fallback legacy copy).'
  );
  assert.equal(
    formatClipboardCopySuccessMessage(2, 'link-uri', 'clipboard'),
    'Am copiat 2 link-uri în clipboard.'
  );
  assert.match(
    formatClipboardCopyErrorMessage('ID-urile', 'Denied'),
    /Nu am putut copia ID-urile în clipboard\. Denied/
  );

  const logs = [];
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await copyVisibleProblemsToClipboard({
      getVisibleProblems: () => [{ id: 1 }],
      toText: () => '',
      copyTextToClipboard: async () => ({ method: 'clipboard' }),
      addLog(message) {
        logs.push(message);
      },
      describeClipboardError: () => 'unused',
      successItemLabel: 'ID-uri',
      failureItemLabel: 'ID-urile',
    });

    await copyVisibleProblemsToClipboard({
      getVisibleProblems: () => [{ id: 1 }, { id: 2 }],
      toText: () => '1\n2',
      copyTextToClipboard: async () => ({ method: 'execCommand' }),
      addLog(message) {
        logs.push(message);
      },
      describeClipboardError: () => 'unused',
      successItemLabel: 'ID-uri',
      failureItemLabel: 'ID-urile',
    });

    await copyVisibleProblemsToClipboard({
      getVisibleProblems: () => [{ id: 3 }],
      toText: () => '3',
      copyTextToClipboard: async () => {
        throw new Error('denied');
      },
      addLog(message) {
        logs.push(message);
      },
      describeClipboardError: () => 'Clipboard blocked',
      successItemLabel: 'ID-uri',
      failureItemLabel: 'ID-urile',
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(logs[0], 'Nimic de copiat.');
  assert.equal(logs[1], 'Am copiat 2 ID-uri în clipboard (fallback legacy copy).');
  assert.match(logs[2], /Clipboard blocked/);
});

test('runtime complexity helpers: deferred-map and kick selection helpers preserve priority ordering', () => {
  const deferredPages = new Map([
    [7, 2],
    [3, 1],
    [5, 4],
  ]);
  assert.deepEqual(takeSmallestDeferredEntry(deferredPages, 'pageIndex'), {
    pageIndex: 3,
    retryCount: 1,
  });
  assert.equal(deferredPages.has(3), false);

  assert.deepEqual(
    selectKickAction({
      deferredVerification: { problemId: 12, retryCount: 1 },
      deferredBatch: { batchStart: 200, retryCount: 0 },
      deferredPage: { pageIndex: 8, retryCount: 0 },
      queueInitialized: true,
      nextSequentialPage: 9,
    }),
    {
      kind: 'verify',
      problemId: 12,
      retryCount: 1,
    }
  );

  assert.deepEqual(
    selectKickAction({
      deferredVerification: null,
      deferredBatch: null,
      deferredPage: null,
      queueInitialized: false,
      nextSequentialPage: 21,
    }),
    {
      kind: 'sequential',
      pageIndex: 21,
    }
  );
});

test('runtime complexity helpers: runtime idle verification gates and snapshot pruning stay deterministic', () => {
  assert.equal(
    isRuntimeQueueDrained({
      queueInitialized: true,
      pageQueueLength: 0,
      deferredScoreBatchCount: 0,
      deferredVerificationCount: 0,
      inFlight: 0,
    }),
    true
  );
  assert.equal(
    isRuntimeQueueDrained({
      queueInitialized: true,
      pageQueueLength: 1,
      deferredScoreBatchCount: 0,
      deferredVerificationCount: 0,
      inFlight: 0,
    }),
    false
  );

  assert.equal(
    shouldStartVerificationPass({
      verificationState: { running: false, enabled: true, completed: false },
      hasUnsolvedProblems: true,
    }),
    true
  );
  assert.equal(
    shouldStartVerificationPass({
      verificationState: { running: true, enabled: true, completed: false },
      hasUnsolvedProblems: true,
    }),
    false
  );

  const pruneResult = pruneSnapshotEntries(
    [
      { id: 'a', storageVersion: 2 },
      { id: 'b', storageVersion: 2 },
      { id: 'c', storageVersion: 2 },
    ],
    {
      maxEntries: 2,
      snapshotItemKey(id) {
        return `key-${id}`;
      },
      storageHasValue(key) {
        return key !== 'key-b';
      },
    }
  );

  assert.deepEqual(
    pruneResult.pruned.map((entry) => entry.id),
    ['a', 'c']
  );
  assert.deepEqual(pruneResult.staleKeys, ['key-b']);
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

test('runtime complexity helpers: trust metric fallbacks cover no-target and unknown-percent branches', function trustMetricFallbackBranches() {
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

function assertSnapshotAppliersMutateTargetsSafely() {
  const pagination = { mode: 'offset', param: 'start', pageBase: 1 };
  applyPaginationSnapshot(pagination, { mode: 'page', param: 'p', pageBase: 10 });
  assert.deepEqual(pagination, { mode: 'page', param: 'p', pageBase: 10 });

  const idRange = {
    startId: 1,
    endId: 8000,
    stopAfterMissing: 0,
    scoreBatch: { enabled: true, size: 200 },
  };
  applyIdRangeSnapshot(idRange, {
    startId: 22,
    endId: 99,
    stopAfterMissing: 5,
    scoreBatch: { enabled: false, size: 50 },
  });
  assert.deepEqual(idRange, {
    startId: 22,
    endId: 99,
    stopAfterMissing: 5,
    scoreBatch: { enabled: false, size: 50 },
  });

  const sorted = { id: 1, score: -1, difficulty: 0 };
  applySortedSnapshot(sorted, { id: -1, score: 1, difficulty: Number.NaN });
  assert.deepEqual(sorted, { id: -1, score: 1, difficulty: 0 });
}

test('runtime complexity helpers: pagination/id-range/sorted snapshot appliers mutate targets safely', function paginationAndSnapshotApplierBranches() {
  assertSnapshotAppliersMutateTargetsSafely();
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

test('runtime complexity helpers: response and request helpers cover defensive branches', function responseAndRequestHelperDefensiveBranches() {
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

test('runtime complexity helpers: pbinfo-runtime clipboard helpers format messages and guard branches', async () => {
  assert.equal(
    formatClipboardCopySuccessMessage(4, 'ID-uri', 'execCommand'),
    'Am copiat 4 ID-uri în clipboard (fallback legacy copy).'
  );
  assert.equal(
    formatClipboardCopySuccessMessage(2, 'link-uri', 'clipboard'),
    'Am copiat 2 link-uri în clipboard.'
  );
  assert.match(
    formatClipboardCopyErrorMessage('ID-urile', 'Denied'),
    /Nu am putut copia ID-urile în clipboard\. Denied/
  );

  const logs = [];
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await copyVisibleProblemsToClipboard({
      getVisibleProblems: () => [{ id: 1 }],
      toText: () => '',
      copyTextToClipboard: async () => ({ method: 'clipboard' }),
      addLog(message) {
        logs.push(message);
      },
      describeClipboardError: () => 'unused',
      successItemLabel: 'ID-uri',
      failureItemLabel: 'ID-urile',
    });

    await copyVisibleProblemsToClipboard({
      getVisibleProblems: () => [{ id: 1 }, { id: 2 }],
      toText: () => '1\n2',
      copyTextToClipboard: async () => ({ method: 'execCommand' }),
      addLog(message) {
        logs.push(message);
      },
      describeClipboardError: () => 'unused',
      successItemLabel: 'ID-uri',
      failureItemLabel: 'ID-urile',
    });

    await copyVisibleProblemsToClipboard({
      getVisibleProblems: () => [{ id: 3 }],
      toText: () => '3',
      copyTextToClipboard: async () => {
        throw new Error('denied');
      },
      addLog(message) {
        logs.push(message);
      },
      describeClipboardError: () => 'Clipboard blocked',
      successItemLabel: 'ID-uri',
      failureItemLabel: 'ID-urile',
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(logs[0], 'Nimic de copiat.');
  assert.equal(logs[1], 'Am copiat 2 ID-uri în clipboard (fallback legacy copy).');
  assert.match(logs[2], /Clipboard blocked/);
});

test('runtime complexity helpers: deferred-map and kick selection helpers preserve priority ordering', () => {
  const deferredPages = new Map([
    [7, 2],
    [3, 1],
    [5, 4],
  ]);
  assert.deepEqual(takeSmallestDeferredEntry(deferredPages, 'pageIndex'), {
    pageIndex: 3,
    retryCount: 1,
  });
  assert.equal(deferredPages.has(3), false);

  assert.deepEqual(
    selectKickAction({
      deferredVerification: { problemId: 12, retryCount: 1 },
      deferredBatch: { batchStart: 200, retryCount: 0 },
      deferredPage: { pageIndex: 8, retryCount: 0 },
      queueInitialized: true,
      nextSequentialPage: 9,
    }),
    {
      kind: 'verify',
      problemId: 12,
      retryCount: 1,
    }
  );

  assert.deepEqual(
    selectKickAction({
      deferredVerification: null,
      deferredBatch: null,
      deferredPage: null,
      queueInitialized: false,
      nextSequentialPage: 21,
    }),
    {
      kind: 'sequential',
      pageIndex: 21,
    }
  );
});

test('runtime complexity helpers: runtime idle verification gates and snapshot pruning stay deterministic', () => {
  assert.equal(
    isRuntimeQueueDrained({
      queueInitialized: true,
      pageQueueLength: 0,
      deferredScoreBatchCount: 0,
      deferredVerificationCount: 0,
      inFlight: 0,
    }),
    true
  );
  assert.equal(
    isRuntimeQueueDrained({
      queueInitialized: true,
      pageQueueLength: 1,
      deferredScoreBatchCount: 0,
      deferredVerificationCount: 0,
      inFlight: 0,
    }),
    false
  );

  assert.equal(
    shouldStartVerificationPass({
      verificationState: { running: false, enabled: true, completed: false },
      hasUnsolvedProblems: true,
    }),
    true
  );
  assert.equal(
    shouldStartVerificationPass({
      verificationState: { running: true, enabled: true, completed: false },
      hasUnsolvedProblems: true,
    }),
    false
  );

  const pruneResult = pruneSnapshotEntries(
    [
      { id: 'a', storageVersion: 2 },
      { id: 'b', storageVersion: 2 },
      { id: 'c', storageVersion: 2 },
    ],
    {
      maxEntries: 2,
      snapshotItemKey(id) {
        return `key-${id}`;
      },
      storageHasValue(key) {
        return key !== 'key-b';
      },
    }
  );

  assert.deepEqual(
    pruneResult.pruned.map((entry) => entry.id),
    ['a', 'c']
  );
  assert.deepEqual(pruneResult.staleKeys, ['key-b']);
});
