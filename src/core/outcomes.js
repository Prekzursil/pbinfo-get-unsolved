const { normalizeSpace, normalizeForMatch } = require('./text-utils');
const OUTCOME_STATUS_ALIASES = {
  success: 'success',
  blocked: 'blocked',
  'rate-limited': 'rate-limited',
  ratelimited: 'rate-limited',
  rate_limited: 'rate-limited',
  timeout: 'timeout',
  'parse-fail': 'parse-fail',
  parsefail: 'parse-fail',
  parse_fail: 'parse-fail',
  'http-error': 'http-error',
  httperror: 'http-error',
  http_error: 'http-error',
  skipped: 'skipped',
};

const OUTCOME_STATUS_SUMMARY_KEYS = {
  success: 'success',
  blocked: 'blocked',
  'rate-limited': 'rateLimited',
  timeout: 'timeout',
  'parse-fail': 'parseFail',
  'http-error': 'httpError',
  skipped: 'skipped',
  unknown: 'unknown',
};

function createOutcomeLedger(seedEntries) {
  const ledger = { entries: {} };

  if (Array.isArray(seedEntries)) {
    seedEntries.forEach(function (entry) {
      recordOutcomeEntry(ledger, entry);
    });
  }

  return ledger;
}

function getLedgerEntries(ledger) {
  return Object.values(ledger?.entries || {});
}

function makeOutcomeKey(targetType, targetKey) {
  const type = normalizeSpace(targetType || 'unknown') || 'unknown';
  const key = normalizeSpace(targetKey == null ? '' : String(targetKey)) || '?';

  return type + ':' + key;
}

function normalizeOutcomeStatus(status) {
  const value = normalizeForMatch(status || '');
  if (Object.hasOwn(OUTCOME_STATUS_ALIASES, value)) {
    return OUTCOME_STATUS_ALIASES[value];
  }
  return 'unknown';
}

function ensureLedgerEntriesMap(ledger) {
  if (!ledger.entries || typeof ledger.entries !== 'object') {
    ledger.entries = {};
  }
}

function readOutcomeRetryCount(outcome) {
  if (!Number.isFinite(outcome?.retryCount)) {
    return 0;
  }
  return Math.max(0, outcome.retryCount);
}

function readOutcomeDuration(outcome) {
  if (!Number.isFinite(outcome?.durationMs)) {
    return null;
  }
  return Math.max(0, outcome.durationMs);
}

function readOutcomeTargetType(outcome) {
  return normalizeSpace(outcome?.targetType || 'unknown') || 'unknown';
}

function readOutcomeTargetKey(outcome) {
  return normalizeSpace(outcome?.targetKey == null ? '' : String(outcome.targetKey)) || '?';
}

function readOutcomeUpdatedAt(outcome) {
  if (Number.isFinite(outcome?.updatedAt)) {
    return outcome.updatedAt;
  }
  return Date.now();
}

function buildOutcomeEntry(outcome, key, previousStatus) {
  const entry = {};
  entry.key = key;
  entry.targetType = readOutcomeTargetType(outcome);
  entry.targetKey = readOutcomeTargetKey(outcome);
  entry.status = normalizeOutcomeStatus(outcome?.status);
  entry.retryCount = readOutcomeRetryCount(outcome);
  entry.durationMs = readOutcomeDuration(outcome);
  entry.updatedAt = readOutcomeUpdatedAt(outcome);
  entry.previousStatus = previousStatus;
  return entry;
}

function addRetryCount(summary, entry) {
  if (Number.isFinite(entry?.retryCount)) {
    summary.retryCount += Math.max(0, entry.retryCount);
  }
}

function addDuration(state, entry) {
  if (Number.isFinite(entry?.durationMs)) {
    state.total += Math.max(0, entry.durationMs);
    state.count += 1;
  }
}

function addStatusCount(summary, entry) {
  const status = normalizeOutcomeStatus(entry?.status);
  const summaryKey = OUTCOME_STATUS_SUMMARY_KEYS[status];
  summary[summaryKey] += 1;
}

function recordOutcomeEntry(ledger, outcome) {
  if (!ledger || typeof ledger !== 'object') {
    return null;
  }
  ensureLedgerEntriesMap(ledger);
  const key = makeOutcomeKey(outcome?.targetType, outcome?.targetKey);
  const previousStatus = ledger.entries[key]?.status || null;
  const next = buildOutcomeEntry(outcome, key, previousStatus);

  ledger.entries[next.key] = next;
  return next;
}

function summarizeOutcomeLedger(ledger) {
  const entries = getLedgerEntries(ledger);
  const summary = {
    total: entries.length,
    success: 0,
    blocked: 0,
    rateLimited: 0,
    timeout: 0,
    parseFail: 0,
    httpError: 0,
    skipped: 0,
    unknown: 0,
    unknowns: 0,
    retryCount: 0,
    avgDurationMs: 0,
  };
  const durationState = { total: 0, count: 0 };

  entries.forEach(function (entry) {
    addStatusCount(summary, entry);
    addRetryCount(summary, entry);
    addDuration(durationState, entry);
  });

  summary.unknowns =
    summary.blocked +
    summary.rateLimited +
    summary.timeout +
    summary.parseFail +
    summary.httpError +
    summary.unknown;
  summary.avgDurationMs =
    durationState.count > 0 ? Math.round(durationState.total / durationState.count) : 0;

  return summary;
}

function listRetryableOutcomeEntries(ledger) {
  const retryable = new Set([
    'blocked',
    'rate-limited',
    'timeout',
    'parse-fail',
    'http-error',
    'unknown',
  ]);

  return getLedgerEntries(ledger).filter(function (entry) {
    return retryable.has(normalizeOutcomeStatus(entry?.status));
  });
}

function listRetryableOutcomeKeys(ledger) {
  return listRetryableOutcomeEntries(ledger).map(function (entry) {
    return entry.key;
  });
}

module.exports = {
  createOutcomeLedger,
  recordOutcomeEntry,
  summarizeOutcomeLedger,
  listRetryableOutcomeKeys,
  listRetryableOutcomeEntries,
};
