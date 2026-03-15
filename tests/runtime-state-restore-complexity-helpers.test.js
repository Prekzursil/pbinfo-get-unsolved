const test = require('node:test');
const assert = require('node:assert/strict');

const { restoreRuntimeSnapshotState } = require('../src/core/runtime-state-restore');

const RUNTIME_REHYDRATE_MIGRATED_SNAPSHOT = {
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

function cloneRuntimeRehydrateSnapshot() {
  return {
    ...RUNTIME_REHYDRATE_MIGRATED_SNAPSHOT,
    verification: { ...RUNTIME_REHYDRATE_MIGRATED_SNAPSHOT.verification },
    cachePolicy: { ...RUNTIME_REHYDRATE_MIGRATED_SNAPSHOT.cachePolicy },
    filters: {
      ...RUNTIME_REHYDRATE_MIGRATED_SNAPSHOT.filters,
      statuses: [...RUNTIME_REHYDRATE_MIGRATED_SNAPSHOT.filters.statuses],
      qualities: [...RUNTIME_REHYDRATE_MIGRATED_SNAPSHOT.filters.qualities],
    },
    sorted: { ...RUNTIME_REHYDRATE_MIGRATED_SNAPSHOT.sorted },
    pageQueue: [...RUNTIME_REHYDRATE_MIGRATED_SNAPSHOT.pageQueue],
    deferred: RUNTIME_REHYDRATE_MIGRATED_SNAPSHOT.deferred.map((entry) => [...entry]),
    inFlightPages: [...RUNTIME_REHYDRATE_MIGRATED_SNAPSHOT.inFlightPages],
  };
}

function createRuntimeRehydrateMutableState() {
  return {
    inFlight: 7,
    stopRequested: false,
    paused: false,
    scanEnd: null,
    startedAt: 0,
    pageSize: 10,
    totalProblems: 0,
    totalPages: 0,
    queueInitialized: false,
    nextSequentialPage: null,
    finished: false,
    setupControlsCalls: 0,
    ensured: 0,
    rendered: 0,
    progressArg: null,
    refreshCacheCalls: 0,
  };
}

function createRuntimeRehydrateCollections() {
  return {
    stats: {},
    allProblems: [],
    seenProblemIds: new Set(),
    outcomeLedger: { entries: { stale: { status: 'timeout' } } },
    verificationState: {},
    filterState: {
      statuses: new Set(['solved']),
      qualities: new Set(['all']),
      includeUnknownScore: false,
      scoreMin: null,
      scoreMax: null,
      searchQuery: '',
    },
    sorted: { id: 0, score: 0, difficulty: 0 },
    pageQueue: [999],
    deferredPageRequests: new Map([[999, 3]]),
    deferredCalls: [],
    logs: [],
    pauseButton: { textContent: '', disabled: false },
    stopButton: { disabled: false },
  };
}

function createRuntimeRehydrateHarness() {
  return {
    activeRequests: new Set([
      { abort() {} },
      {
        abort() {
          throw new Error('abort failed');
        },
      },
      { abort: null },
    ]),
    activePageIndexes: new Set([1, 2]),
    state: createRuntimeRehydrateMutableState(),
    config: {
      pagination: { mode: 'offset', param: 'start', pageBase: 1 },
      idRange: {
        startId: 1,
        endId: 100,
        stopAfterMissing: 0,
        scoreBatch: { enabled: true, size: 5 },
      },
      cache: { enabled: true, ttlMs: 1000, forceRefresh: false },
      startPage: 1,
    },
    ...createRuntimeRehydrateCollections(),
  };
}

function buildRuntimeRehydrateRestoreArgs(harness) {
  const { state, deferredCalls, logs } = harness;
  const setState = (key) => (value) => {
    state[key] = value;
  };

  return {
    migrated: cloneRuntimeRehydrateSnapshot(),
    kind: 'minimal',
    scanMode: 'id-range',
    activeRequests: harness.activeRequests,
    activePageIndexes: harness.activePageIndexes,
    config: harness.config,
    stats: harness.stats,
    allProblems: harness.allProblems,
    seenProblemIds: harness.seenProblemIds,
    outcomeLedger: harness.outcomeLedger,
    verificationState: harness.verificationState,
    filterState: harness.filterState,
    sorted: harness.sorted,
    pageQueue: harness.pageQueue,
    deferredPageRequests: harness.deferredPageRequests,
    pauseButton: harness.pauseButton,
    stopButton: harness.stopButton,
    setInFlight: setState('inFlight'),
    setStopRequested: setState('stopRequested'),
    setPaused: setState('paused'),
    setScanEnd: setState('scanEnd'),
    setStartedAt: setState('startedAt'),
    getPageSize: () => state.pageSize,
    setPageSize: setState('pageSize'),
    getTotalProblems: () => state.totalProblems,
    setTotalProblems: setState('totalProblems'),
    getTotalPages: () => state.totalPages,
    setTotalPages: setState('totalPages'),
    refreshParsedCacheAvailability: () => {
      state.refreshCacheCalls += 1;
    },
    setQueueInitialized: setState('queueInitialized'),
    setNextSequentialPage: setState('nextSequentialPage'),
    deferPage: (pageIndex, retryCount) => deferredCalls.push([pageIndex, retryCount]),
    setFinished: setState('finished'),
    setupControls: () => {
      state.setupControlsCalls += 1;
    },
    ensureResultsAttached: () => {
      state.ensured += 1;
    },
    renderResults: () => {
      state.rendered += 1;
    },
    getInFlight: () => state.inFlight,
    updateProgress: setState('progressArg'),
    addLog: (message) => logs.push(message),
  };
}

function assertRuntimeRehydrateResult(harness, restored) {
  const { state } = harness;

  assert.equal(restored, true);
  assert.equal(harness.activeRequests.size, 0);
  assert.equal(harness.activePageIndexes.size, 0);
  assert.equal(state.inFlight, 0);
  assert.equal(state.stopRequested, true);
  assert.equal(state.paused, true);
  assert.deepEqual(state.scanEnd, { finished: false });
  assert.equal(harness.config.pagination.mode, 'page');
  assert.equal(harness.config.idRange.startId, 11);
  assert.equal(harness.config.startPage, 4);
  assert.ok(Number.isFinite(state.startedAt));
  assert.equal(state.pageSize, 25);
  assert.equal(state.totalProblems, 100);
  assert.equal(state.totalPages, 10);
  assert.equal(harness.stats.total, 6);
  assert.equal(harness.allProblems.length, 1);
  assert.ok(harness.seenProblemIds.has(7));
  assert.ok(harness.seenProblemIds.has(8));
  assert.equal(state.refreshCacheCalls, 1);
  assert.deepEqual([...harness.filterState.statuses], ['solved']);
  assert.deepEqual([...harness.filterState.qualities], ['verified']);
  assert.equal(state.queueInitialized, true);
  assert.deepEqual(harness.pageQueue, [10]);
  assert.equal(harness.deferredPageRequests.get(12), 1);
  assert.equal(state.nextSequentialPage, 13);
  assert.deepEqual(harness.deferredCalls, [[14, 0]]);
  assert.equal(state.setupControlsCalls, 1);
  assert.equal(harness.pauseButton.textContent, 'Continuă');
  assert.equal(harness.stopButton.disabled, false);
  assert.equal(state.ensured, 1);
  assert.equal(state.rendered, 1);
  assert.equal(state.progressArg, 0);
  assert.equal(state.finished, false);
  assert.equal(harness.logs.length, 1);
}

test('runtime complexity helpers: runtime-state-restore rehydrates and applies snapshot payload', function runtimeStateRestoreRehydratesSnapshotPayload() {
  const harness = createRuntimeRehydrateHarness();
  const restored = restoreRuntimeSnapshotState(buildRuntimeRehydrateRestoreArgs(harness));
  assertRuntimeRehydrateResult(harness, restored);
});

test('runtime complexity helpers: runtime-state-restore logs compact note for minimal snapshots', function runtimeStateRestoreLogsCompactMinimalSnapshotNote() {
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

test('runtime complexity helpers: runtime-state-restore fallback branches keep defaults and resume cursor', function runtimeStateRestoreFallbackBranchesKeepDefaults() {
  let scanEnd = 'unset';
  let pageSize = 10;
  let totalProblems = 20;
  let totalPages = 3;
  let nextSequentialPage = null;
  const pauseButton = { textContent: '', disabled: false };
  const stopButton = { disabled: false };
  const config = {
    pagination: { mode: 'offset', param: 'start', pageBase: 1 },
    idRange: {
      startId: 1,
      endId: 2,
      stopAfterMissing: 0,
      scoreBatch: { enabled: true, size: 1 },
    },
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
