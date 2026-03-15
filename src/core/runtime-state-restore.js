const { recordOutcomeEntry } = require('./outcomes');
const { restoreProblemsFromSnapshot } = require('./snapshot');
const {
  normalizeStatsSnapshot,
  normalizeVerificationSnapshot,
  normalizeFilterSnapshot,
  applyPaginationSnapshot,
  applyIdRangeSnapshot,
  applySortedSnapshot,
} = require('./runtime-state-persistence');

function abortRequestSafely(xhr) {
  const abortFn = xhr?.abort;
  if (typeof abortFn !== 'function') return;
  try {
    abortFn.call(xhr);
  } catch {
    // Ignore abort races from stale request handles.
  }
}

function abortAndResetRequests(activeRequests, activePageIndexes, setInFlight) {
  for (const xhr of activeRequests) {
    abortRequestSafely(xhr);
  }
  activeRequests.clear();
  activePageIndexes.clear();
  setInFlight(0);
}

function restoreScanState(migrated, setStopRequested, setPaused, setScanEnd) {
  const restoredScanEnd = migrated.end && typeof migrated.end === 'object' ? migrated.end : null;
  setStopRequested(Boolean(migrated.stopRequested));
  setPaused(Boolean(migrated.paused));
  setScanEnd(restoredScanEnd);
  return restoredScanEnd;
}

function applyRestoredScanConfig(config, scanMode, migrated) {
  applyPaginationSnapshot(config.pagination, migrated.pagination);
  if (scanMode === 'id-range') {
    applyIdRangeSnapshot(config.idRange, migrated.idRange);
  }

  if (Number.isFinite(migrated.scanStartPage)) {
    config.startPage = migrated.scanStartPage;
  }
}

function applyRestoredStartedAt(migrated, setStartedAt) {
  const elapsed = Number.isFinite(migrated.elapsedMs) ? migrated.elapsedMs : null;
  if (elapsed != null && elapsed >= 0) {
    setStartedAt(Date.now() - elapsed);
  }
}

function applyRestoredTotalsAndPageSize(context) {
  const migrated = context.migrated;
  const getPageSize = context.getPageSize;
  const setPageSize = context.setPageSize;
  const getTotalProblems = context.getTotalProblems;
  const setTotalProblems = context.setTotalProblems;
  const getTotalPages = context.getTotalPages;
  const setTotalPages = context.setTotalPages;
  const nextPageSize = Number.isFinite(migrated.pageSize) ? migrated.pageSize : getPageSize();
  const nextTotalProblems = Number.isFinite(migrated.totalProblems)
    ? migrated.totalProblems
    : getTotalProblems();
  const nextTotalPages = Number.isFinite(migrated.totalPages)
    ? migrated.totalPages
    : getTotalPages();
  setPageSize(nextPageSize);
  setTotalProblems(nextTotalProblems);
  setTotalPages(nextTotalPages);
}

function restoreConfigAndStats(context) {
  applyRestoredScanConfig(context.config, context.scanMode, context.migrated);
  applyRestoredStartedAt(context.migrated, context.setStartedAt);
  applyRestoredTotalsAndPageSize(context);
  Object.assign(context.stats, normalizeStatsSnapshot(context.migrated.stats));
}

function clearRestoredCollections(allProblems, seenProblemIds, outcomeLedger) {
  allProblems.length = 0;
  seenProblemIds.clear();
  for (const key of Object.keys(outcomeLedger.entries || {})) {
    delete outcomeLedger.entries[key];
  }
}

function restoreProblemsAndOutcomes(migrated, allProblems, seenProblemIds, outcomeLedger) {
  const restoredProblems = restoreProblemsFromSnapshot(migrated);
  for (const problem of restoredProblems.allProblems) {
    allProblems.push(problem);
  }
  for (const id of restoredProblems.seenProblemIds) {
    seenProblemIds.add(id);
  }
  if (Array.isArray(migrated.outcomes)) {
    for (const outcome of migrated.outcomes) {
      recordOutcomeEntry(outcomeLedger, outcome);
    }
  }
}

function restoreVerificationAndCache(
  migrated,
  verificationState,
  config,
  refreshParsedCacheAvailability
) {
  Object.assign(verificationState, normalizeVerificationSnapshot(migrated.verification));

  if (migrated.cachePolicy && typeof migrated.cachePolicy === 'object') {
    config.cache.enabled = migrated.cachePolicy.enabled !== false;
    config.cache.ttlMs = Number.isFinite(migrated.cachePolicy.ttlMs)
      ? migrated.cachePolicy.ttlMs
      : config.cache.ttlMs;
    config.cache.forceRefresh = migrated.cachePolicy.forceRefresh === true;
    refreshParsedCacheAvailability();
  }
}

function restoreFiltersAndSorting(migrated, filterState, sorted) {
  const restoredFilters = normalizeFilterSnapshot(migrated.filters);
  filterState.statuses.clear();
  for (const status of restoredFilters.statuses) {
    filterState.statuses.add(status);
  }
  filterState.qualities.clear();
  for (const quality of restoredFilters.qualities) {
    filterState.qualities.add(quality);
  }
  filterState.includeUnknownScore = restoredFilters.includeUnknownScore;
  filterState.scoreMin = restoredFilters.scoreMin;
  filterState.scoreMax = restoredFilters.scoreMax;
  filterState.searchQuery = restoredFilters.searchQuery;

  applySortedSnapshot(sorted, migrated.sorted);
}

function restorePageQueueFromSnapshot(pageQueue, snapshotQueue) {
  if (!Array.isArray(snapshotQueue)) return;
  for (const pageIndex of snapshotQueue) {
    if (Number.isFinite(pageIndex)) {
      pageQueue.push(pageIndex);
    }
  }
}

function restoreDeferredPageRequestsFromSnapshot(deferredPageRequests, snapshotDeferred) {
  if (!Array.isArray(snapshotDeferred)) return;
  for (const entry of snapshotDeferred) {
    const pageIndex = entry?.[0];
    const retryCount = entry?.[1];
    if (Number.isFinite(pageIndex) && Number.isFinite(retryCount)) {
      deferredPageRequests.set(pageIndex, retryCount);
    }
  }
}

function resolveNextSequentialPageFromSnapshot(migrated) {
  if (Number.isFinite(migrated.nextSequentialPage)) {
    return migrated.nextSequentialPage;
  }
  if (Number.isFinite(migrated.resumeFromPage)) {
    return migrated.resumeFromPage;
  }
  return null;
}

function restoreInFlightPagesFromSnapshot(snapshotInFlightPages, deferPage) {
  if (!Array.isArray(snapshotInFlightPages)) return;
  for (const pageIndex of snapshotInFlightPages) {
    deferPage(pageIndex, 0);
  }
}

function resetQueueStateCollections(pageQueue, deferredPageRequests) {
  pageQueue.length = 0;
  deferredPageRequests.clear();
}

function restoreQueueSnapshotCollections(migrated, pageQueue, deferredPageRequests) {
  restorePageQueueFromSnapshot(pageQueue, migrated.pageQueue);
  restoreDeferredPageRequestsFromSnapshot(deferredPageRequests, migrated.deferred);
}

function restoreQueueState({
  migrated,
  pageQueue,
  deferredPageRequests,
  setQueueInitialized,
  setNextSequentialPage,
  deferPage,
}) {
  resetQueueStateCollections(pageQueue, deferredPageRequests);
  setQueueInitialized(Boolean(migrated.queueInitialized));

  restoreQueueSnapshotCollections(migrated, pageQueue, deferredPageRequests);
  setNextSequentialPage(resolveNextSequentialPageFromSnapshot(migrated));
  restoreInFlightPagesFromSnapshot(migrated.inFlightPages, deferPage);
}

function updateControlsForRestoredState({
  finished,
  paused,
  setFinished,
  setupControls,
  pauseButton,
  stopButton,
}) {
  setFinished(finished);
  setupControls();

  if (pauseButton) {
    pauseButton.textContent = paused ? 'Continuă' : 'Pauză';
    pauseButton.disabled = finished;
  }
  if (stopButton) {
    stopButton.disabled = finished;
  }
}

function appendRestoreLevelNote(kind, migrated, addLog) {
  if (kind === 'minimal' && migrated.storageLevel === 'progress') {
    addLog(
      '<span style="color:#b35c00;"><b>Notă:</b> stare salvată doar ca progres; lista completă nu este disponibilă.</span>'
    );
    return;
  }
  if (kind === 'minimal') {
    addLog(
      '<span style="color:#b35c00;"><b>Notă:</b> stare salvată compact; unele metadate (autor/sursă) pot lipsi.</span>'
    );
  }
}

function restoreRuntimeDataCollections(context) {
  clearRestoredCollections(context.allProblems, context.seenProblemIds, context.outcomeLedger);
  restoreProblemsAndOutcomes(
    context.migrated,
    context.allProblems,
    context.seenProblemIds,
    context.outcomeLedger
  );
  restoreVerificationAndCache(
    context.migrated,
    context.verificationState,
    context.config,
    context.refreshParsedCacheAvailability
  );
  restoreFiltersAndSorting(context.migrated, context.filterState, context.sorted);
  restoreQueueState({
    migrated: context.migrated,
    pageQueue: context.pageQueue,
    deferredPageRequests: context.deferredPageRequests,
    setQueueInitialized: context.setQueueInitialized,
    setNextSequentialPage: context.setNextSequentialPage,
    deferPage: context.deferPage,
  });
}

function applyRestoredRuntimeUi(context, restoredScanEnd) {
  const finished = Boolean(restoredScanEnd?.finished);
  updateControlsForRestoredState({
    finished,
    paused: context.migrated.paused,
    setFinished: context.setFinished,
    setupControls: context.setupControls,
    pauseButton: context.pauseButton,
    stopButton: context.stopButton,
  });
  if (context.allProblems.length > 0) {
    context.ensureResultsAttached();
  }
  context.renderResults();
  context.updateProgress(context.getInFlight());
  appendRestoreLevelNote(context.kind, context.migrated, context.addLog);
}

function restoreRuntimeSnapshotState(context) {
  abortAndResetRequests(context.activeRequests, context.activePageIndexes, context.setInFlight);
  const restoredScanEnd = restoreScanState(
    context.migrated,
    context.setStopRequested,
    context.setPaused,
    context.setScanEnd
  );
  restoreConfigAndStats({
    migrated: context.migrated,
    scanMode: context.scanMode,
    config: context.config,
    setStartedAt: context.setStartedAt,
    getPageSize: context.getPageSize,
    setPageSize: context.setPageSize,
    getTotalProblems: context.getTotalProblems,
    setTotalProblems: context.setTotalProblems,
    getTotalPages: context.getTotalPages,
    setTotalPages: context.setTotalPages,
    stats: context.stats,
  });
  restoreRuntimeDataCollections(context);
  applyRestoredRuntimeUi(context, restoredScanEnd);

  return true;
}

module.exports = {
  restoreRuntimeSnapshotState,
};
