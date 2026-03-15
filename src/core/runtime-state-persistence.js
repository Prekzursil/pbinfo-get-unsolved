function toFiniteNumberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function resolveSaveStateLevels({ mode, progressOnly }) {
  const desired = mode === 'minimal' || mode === 'progress' ? mode : 'full';
  let levels = ['progress'];

  if (desired === 'full') {
    levels = ['full', 'minimal', 'progress'];
  } else if (desired === 'minimal') {
    levels = ['minimal', 'progress'];
  }

  if (progressOnly && levels[0] === 'full') {
    return levels.slice(1);
  }
  return levels;
}

function normalizeStatsSnapshot(stats) {
  return {
    solved: toFiniteNumberOr(stats?.solved, 0),
    tried: toFiniteNumberOr(stats?.tried, 0),
    unattempted: toFiniteNumberOr(stats?.unattempted, 0),
    total: toFiniteNumberOr(stats?.total, 0),
    pages: toFiniteNumberOr(stats?.pages, 0),
    missing: toFiniteNumberOr(stats?.missing, 0),
    forbidden: toFiniteNumberOr(stats?.forbidden, 0),
  };
}

function normalizeVerificationSnapshot(verification) {
  return {
    enabled: verification?.enabled === true,
    running: verification?.running === true,
    completed: verification?.completed === true,
    attempted: toFiniteNumberOr(verification?.attempted, 0),
    verifiedUnsolved: toFiniteNumberOr(verification?.verifiedUnsolved, 0),
    reclassifiedSolved: toFiniteNumberOr(verification?.reclassifiedSolved, 0),
    stillUnknown: toFiniteNumberOr(verification?.stillUnknown, 0),
  };
}

function normalizeFilterSelection(values, allowed, fallback) {
  const source = new Set(Array.isArray(values) ? values : []);
  const normalized = allowed.filter(function (value) {
    return source.has(value);
  });

  if (normalized.length > 0) {
    return normalized;
  }

  return fallback.slice();
}

function normalizeFilterSnapshot(filters) {
  const normalizedStatuses = normalizeFilterSelection(
    filters?.statuses,
    ['solved', 'tried', 'unattempted'],
    ['tried', 'unattempted']
  );
  const normalizedQualities = normalizeFilterSelection(
    filters?.qualities,
    ['all', 'scan-only', 'verified', 'verification-unknown'],
    ['all']
  );

  return {
    statuses: normalizedStatuses,
    qualities: normalizedQualities,
    includeUnknownScore: Boolean(filters?.includeUnknownScore),
    scoreMin: Number.isFinite(filters?.scoreMin) ? filters.scoreMin : null,
    scoreMax: Number.isFinite(filters?.scoreMax) ? filters.scoreMax : null,
    searchQuery: typeof filters?.searchQuery === 'string' ? filters.searchQuery : '',
  };
}

function applyPaginationSnapshot(paginationConfig, paginationSnapshot) {
  if (!paginationSnapshot || typeof paginationSnapshot !== 'object') return;
  if (paginationSnapshot.mode) paginationConfig.mode = paginationSnapshot.mode;
  if (paginationSnapshot.param) paginationConfig.param = paginationSnapshot.param;
  if (Number.isFinite(paginationSnapshot.pageBase)) {
    paginationConfig.pageBase = paginationSnapshot.pageBase;
  }
}

function applyFiniteIdRangeValue(idRangeConfig, key, value) {
  if (!Number.isFinite(value)) {
    return;
  }
  idRangeConfig[key] = value;
}

function applyIdRangeScoreBatchSnapshot(idRangeConfig, scoreBatchSnapshot) {
  if (!scoreBatchSnapshot || typeof scoreBatchSnapshot !== 'object') {
    return;
  }
  if (typeof scoreBatchSnapshot.enabled === 'boolean') {
    idRangeConfig.scoreBatch.enabled = scoreBatchSnapshot.enabled;
  }
  applyFiniteIdRangeValue(idRangeConfig.scoreBatch, 'size', scoreBatchSnapshot.size);
}

function applyIdRangeSnapshot(idRangeConfig, idRangeSnapshot) {
  if (!idRangeSnapshot || typeof idRangeSnapshot !== 'object') return;
  applyFiniteIdRangeValue(idRangeConfig, 'startId', idRangeSnapshot.startId);
  applyFiniteIdRangeValue(idRangeConfig, 'endId', idRangeSnapshot.endId);
  applyFiniteIdRangeValue(idRangeConfig, 'stopAfterMissing', idRangeSnapshot.stopAfterMissing);
  applyIdRangeScoreBatchSnapshot(idRangeConfig, idRangeSnapshot.scoreBatch);
}

function applySortedSnapshot(sortedState, sortedSnapshot) {
  if (!sortedSnapshot || typeof sortedSnapshot !== 'object') return;
  for (const key of Object.keys(sortedState)) {
    sortedState[key] = Number.isFinite(sortedSnapshot[key]) ? sortedSnapshot[key] : 0;
  }
}

module.exports = {
  toFiniteNumberOr,
  resolveSaveStateLevels,
  normalizeStatsSnapshot,
  normalizeVerificationSnapshot,
  normalizeFilterSnapshot,
  applyPaginationSnapshot,
  applyIdRangeSnapshot,
  applySortedSnapshot,
};
