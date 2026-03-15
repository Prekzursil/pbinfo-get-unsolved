const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createParsedCacheEntry,
  isParsedCacheEntryFresh,
  createOutcomeLedger,
  recordOutcomeEntry,
  summarizeOutcomeLedger,
  listRetryableOutcomeKeys,
  filterProblemsByQuality,
} = require('../src/core');

test('core edges ledger: cache helper guard branches', () => {
  const originalNow = Date.now;
  const nowValue = 50_000;

  Date.now = () => nowValue;
  try {
    const defaultEntry = createParsedCacheEntry({});
    assert.equal(defaultEntry.schemaVersion, 1);
    assert.equal(defaultEntry.cacheKind, 'unknown');
    assert.equal(defaultEntry.cacheKey, '?');
    assert.equal(defaultEntry.userNamespace, null);
    assert.equal(defaultEntry.cachedAt, nowValue);
    assert.equal(defaultEntry.expiresAt, nowValue);
  } finally {
    Date.now = originalNow;
  }

  assert.equal(isParsedCacheEntryFresh(null, {}), false);
  assert.equal(isParsedCacheEntryFresh({}, {}), false);
  assert.equal(
    isParsedCacheEntryFresh(
      { cacheKind: 'a', cacheKey: 'b', userNamespace: 'u', expiresAt: 10 },
      { cacheKind: 'x', cacheKey: 'b', userNamespace: 'u', now: 1 }
    ),
    false
  );
  assert.equal(
    isParsedCacheEntryFresh(
      { cacheKind: 'a', cacheKey: 'b', userNamespace: 'u', expiresAt: 10 },
      { cacheKind: 'a', cacheKey: 'x', userNamespace: 'u', now: 1 }
    ),
    false
  );
  assert.equal(
    isParsedCacheEntryFresh(
      { cacheKind: 'a', cacheKey: 'b', userNamespace: 'u', expiresAt: 10 },
      { cacheKind: 'a', cacheKey: 'b', userNamespace: 'u', forceRefresh: true, now: 1 }
    ),
    false
  );
  assert.equal(
    isParsedCacheEntryFresh(
      { cacheKind: 'a', cacheKey: 'b', userNamespace: 'u' },
      { cacheKind: 'a', cacheKey: 'b', userNamespace: 'u', now: 1 }
    ),
    false
  );
});

test('core edges ledger: outcome summary counts normalize alias statuses', () => {
  assert.equal(recordOutcomeEntry(null, {}), null);
  assert.equal(
    recordOutcomeEntry(
      {},
      {
        targetType: 'page',
        targetKey: 0,
        status: 'success',
      }
    ).status,
    'success'
  );

  const seeded = createOutcomeLedger([
    { targetType: 'page', targetKey: 1, status: 'rate_limited', retryCount: 1, durationMs: 10 },
  ]);
  recordOutcomeEntry(seeded, {
    targetType: 'page',
    targetKey: 2,
    status: 'http_error',
    retryCount: 2,
    durationMs: 20,
  });
  recordOutcomeEntry(seeded, {
    targetType: 'page',
    targetKey: 3,
    status: 'skipped',
    retryCount: 0,
  });
  recordOutcomeEntry(seeded, {
    targetType: 'page',
    targetKey: 4,
    status: 'mystery',
    retryCount: 0,
  });

  const summary = summarizeOutcomeLedger(seeded);
  assert.equal(summary.rateLimited, 1);
  assert.equal(summary.httpError, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.unknown, 1);
});

test('core edges ledger: outcome retryable and fallback branches', () => {
  const normalizedEntry = recordOutcomeEntry(
    { entries: null },
    {
      targetType: '',
      targetKey: '',
      status: 'parse_fail',
      retryCount: -5,
      durationMs: -10,
      updatedAt: 'bad',
    }
  );
  const seeded = createOutcomeLedger([
    { targetType: 'page', targetKey: 1, status: 'rate_limited', retryCount: 1, durationMs: 10 },
    { targetType: 'page', targetKey: 2, status: 'http_error', retryCount: 2, durationMs: 20 },
    { targetType: 'page', targetKey: 4, status: 'mystery', retryCount: 0, durationMs: 0 },
  ]);
  const extraLedger = createOutcomeLedger();
  recordOutcomeEntry(extraLedger, { targetType: 'page', targetKey: 'b', status: 'blocked' });
  recordOutcomeEntry(extraLedger, { targetType: 'page', targetKey: 't', status: 'timeout' });

  assert.equal(summarizeOutcomeLedger(null).total, 0);
  assert.equal(normalizedEntry.targetType, 'unknown');
  assert.equal(normalizedEntry.targetKey, '?');
  assert.equal(normalizedEntry.status, 'parse-fail');
  assert.equal(normalizedEntry.retryCount, 0);
  assert.equal(normalizedEntry.durationMs, 0);
  assert.deepEqual(listRetryableOutcomeKeys(seeded), ['page:1', 'page:2', 'page:4']);
  assert.deepEqual(listRetryableOutcomeKeys(extraLedger), ['page:b', 'page:t']);
});

test('core edges ledger: quality filter guard branches', () => {
  assert.deepEqual(filterProblemsByQuality(null, new Set(['verified'])), []);
  assert.equal(filterProblemsByQuality([{ quality: 'verified' }], new Set()).length, 1);
});
