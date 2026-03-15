const { normalizeSpace } = require('./text-utils');

function finiteNumberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildRuntimeConfig(runtimeGlobal = globalThis) {
  return {
    scanMode: 'list',
    idRange: {
      startId: finiteNumberOr(runtimeGlobal.PBINFO_GET_UNSOLVED_ID_START, 1),
      endId: finiteNumberOr(runtimeGlobal.PBINFO_GET_UNSOLVED_ID_END, 8000),
      stopAfterMissing: Math.max(
        0,
        finiteNumberOr(runtimeGlobal.PBINFO_GET_UNSOLVED_ID_MISSING_STOP, 0)
      ),
      scoreBatch: {
        enabled: runtimeGlobal.PBINFO_GET_UNSOLVED_ID_SCORE_BATCH !== false,
        size: Math.max(
          1,
          finiteNumberOr(runtimeGlobal.PBINFO_GET_UNSOLVED_ID_SCORE_BATCH_SIZE, 200)
        ),
      },
    },
    pagination: {
      mode: runtimeGlobal.PBINFO_GET_UNSOLVED_PAGINATION_MODE || 'offset',
      param: runtimeGlobal.PBINFO_GET_UNSOLVED_PAGE_PARAM || 'start',
      pageBase: finiteNumberOr(runtimeGlobal.PBINFO_GET_UNSOLVED_PAGE_BASE, 1),
    },
    pageSize: Number.isFinite(Number(runtimeGlobal.PBINFO_GET_UNSOLVED_PAGE_SIZE))
      ? Number(runtimeGlobal.PBINFO_GET_UNSOLVED_PAGE_SIZE)
      : null,
    concurrency: Math.max(1, finiteNumberOr(runtimeGlobal.PBINFO_GET_UNSOLVED_CONCURRENCY, 1)),
    delayMs: Math.max(0, finiteNumberOr(runtimeGlobal.PBINFO_GET_UNSOLVED_DELAY_MS, 0)),
    adaptiveThrottle: runtimeGlobal.PBINFO_GET_UNSOLVED_ADAPTIVE_THROTTLE !== false,
    backoffBaseMs: Math.max(
      50,
      finiteNumberOr(runtimeGlobal.PBINFO_GET_UNSOLVED_BACKOFF_BASE_MS, 500)
    ),
    backoffCapMs: Math.max(
      250,
      finiteNumberOr(runtimeGlobal.PBINFO_GET_UNSOLVED_BACKOFF_CAP_MS, 15000)
    ),
    backoffJitter: runtimeGlobal.PBINFO_GET_UNSOLVED_BACKOFF_JITTER !== false,
    timeoutMs: Math.max(1000, finiteNumberOr(runtimeGlobal.PBINFO_GET_UNSOLVED_TIMEOUT_MS, 30000)),
    maxRetriesPerPage: Math.max(
      0,
      finiteNumberOr(runtimeGlobal.PBINFO_GET_UNSOLVED_MAX_RETRIES, 3)
    ),
    startPage: Math.max(1, finiteNumberOr(runtimeGlobal.PBINFO_GET_UNSOLVED_START_PAGE, 1)),
    maxPages: Math.max(1, finiteNumberOr(runtimeGlobal.PBINFO_GET_UNSOLVED_MAX_PAGES, 5000)),
    tableRenderChunkSize: Math.max(
      25,
      finiteNumberOr(runtimeGlobal.PBINFO_GET_UNSOLVED_RENDER_CHUNK_SIZE, 150)
    ),
    virtualizeRows: runtimeGlobal.PBINFO_GET_UNSOLVED_VIRTUALIZE_ROWS === true,
    virtualRowsLimit: Math.max(
      100,
      finiteNumberOr(runtimeGlobal.PBINFO_GET_UNSOLVED_VIRTUAL_ROWS_LIMIT, 1200)
    ),
    cache: {
      enabled: runtimeGlobal.PBINFO_GET_UNSOLVED_CACHE_ENABLED !== false,
      ttlMs: Math.max(0, finiteNumberOr(runtimeGlobal.PBINFO_GET_UNSOLVED_CACHE_TTL_MS, 900000)),
      forceRefresh: runtimeGlobal.PBINFO_GET_UNSOLVED_FORCE_REFRESH === true,
    },
    navScope:
      normalizeSpace(runtimeGlobal.PBINFO_GET_UNSOLVED_NAV_SCOPE || 'visible') === 'all'
        ? 'all'
        : 'visible',
  };
}

module.exports = {
  finiteNumberOr,
  buildRuntimeConfig,
};
