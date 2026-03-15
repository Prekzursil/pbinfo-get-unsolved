const { normalizeSpace, normalizeForMatch } = require('./text-utils');
const RANDOM_UINT32_DENOMINATOR = 2 ** 32;
const EMPTY_STATE = Object.freeze({});

function queryAll(root, selector) {
  return Array.from(root?.querySelectorAll?.(selector) || []);
}

function hasClosestMatch(element, selector) {
  return !!element?.closest?.(selector);
}

function isLikelyPbinfoNotFoundHtml(html) {
  const text = normalizeForMatch(String(html || ''));

  return (
    text.includes('pagina nu exista') || text.includes('pagina nu există') || text.includes(' 404 ')
  );
}

function isLikelyPbinfoBlockedHtml(html) {
  const text = String(html || '');

  return (
    /cdn-cgi\/challenge-platform/i.test(text) ||
    /cf-chl/i.test(text) ||
    /attention required/i.test(text) ||
    /security check/i.test(text)
  );
}

function parseTotalProblems(html) {
  const match = /class="[^"]*\bnumar_probleme\b[^"]*"[^>]*>\s*(\d+)\s*</i.exec(html || '');
  const value = match ? Number.parseInt(match[1], 10) : Number.NaN;

  return Number.isFinite(value) ? value : null;
}

function normalizeListUrl(inputUrl, baseUrl, paginationParam) {
  const rawInput = normalizeSpace(inputUrl);
  const rawBase = normalizeSpace(baseUrl);
  const parameter = normalizeSpace(paginationParam || 'start') || 'start';
  let url;

  if (!rawInput && !rawBase) {
    return null;
  }

  try {
    url = new URL(rawInput || rawBase, rawBase || undefined);
  } catch {
    return null;
  }

  url.searchParams.delete(parameter);
  return url.toString();
}

function readPageMode(mode) {
  if (mode === 'page') {
    return 'page';
  }
  return 'offset';
}

function readFiniteWithFallback(value, fallback) {
  if (Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function readPageIndex(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}

function computePageValue(mode, pageBase, pageIndex, pageSize) {
  if (mode === 'page') {
    return pageBase + (pageIndex - 1);
  }
  return pageSize * (pageIndex - 1);
}

function readPageParameter(current) {
  return normalizeSpace(current.param || 'start') || 'start';
}

function readPageSize(current) {
  return readFiniteWithFallback(current.pageSize, 10);
}

function readPageBase(current) {
  return readFiniteWithFallback(current.pageBase, 1);
}

function parseBaseUrl(baseUrl) {
  if (typeof URL.canParse === 'function') return URL.canParse(baseUrl) ? new URL(baseUrl) : null;

  try {
    return new URL(baseUrl);
  } catch {
    return null;
  }
}

function buildPageUrl(baseUrl, options) {
  const current = options && typeof options === 'object' ? options : {};
  const parameter = readPageParameter(current);
  const pageIndex = readPageIndex(current.pageIndex);
  const pageSize = readPageSize(current);
  const mode = readPageMode(current.mode);
  const pageBase = readPageBase(current);
  if (!Number.isFinite(pageIndex)) {
    return null;
  }
  if (!baseUrl) {
    return null;
  }

  const url = parseBaseUrl(baseUrl);
  if (!url) {
    return null;
  }

  const pageValue = computePageValue(mode, pageBase, pageIndex, pageSize);
  url.searchParams.set(parameter, String(pageValue));
  return url.toString();
}

function clampRandom(rawValue) {
  if (!Number.isFinite(rawValue)) {
    return 0;
  }
  return Math.min(1, Math.max(0, rawValue));
}

function readBackoffBaseMs(current) {
  if (Number.isFinite(current.baseMs)) {
    return Math.max(1, Math.trunc(current.baseMs));
  }
  return 500;
}

function readBackoffCapMs(current, baseMs) {
  if (Number.isFinite(current.capMs)) {
    return Math.max(baseMs, Math.trunc(current.capMs));
  }
  return Math.max(baseMs, 15000);
}

function readBackoffRandom(current) {
  if (typeof current.random === 'function') {
    return Number(current.random());
  }
  return readSecureRandomUnit();
}

function readAdaptiveDelay(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function readAdaptiveConcurrency(value) {
  return Number.isFinite(value) ? Math.max(1, value) : 1;
}

function readAdaptiveCleanStreak(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function createAdaptiveThrottleState(state) {
  const currentState = state && typeof state === 'object' ? state : EMPTY_STATE;
  return {
    enabled: currentState.enabled !== false,
    baseDelayMs: readAdaptiveDelay(currentState.baseDelayMs),
    baseConcurrency: readAdaptiveConcurrency(currentState.baseConcurrency),
    delayMs: readAdaptiveDelay(currentState.delayMs),
    concurrency: readAdaptiveConcurrency(currentState.concurrency),
    cleanStreak: readAdaptiveCleanStreak(currentState.cleanStreak),
  };
}

function readAdaptiveCapMs(next, options) {
  if (Number.isFinite(options?.capMs)) {
    return Math.max(next.baseDelayMs, Math.trunc(options.capMs));
  }
  return Math.max(next.baseDelayMs, 15000);
}

function applySuccessAdaptiveState(next) {
  next.cleanStreak += 1;
  if (next.cleanStreak < 20) {
    return next;
  }
  next.cleanStreak = 0;
  next.delayMs = Math.max(next.baseDelayMs, Math.floor(next.delayMs * 0.85));
  next.concurrency = Math.min(next.baseConcurrency, next.concurrency + 1);
  return next;
}

function applyBlockedAdaptiveState(next, capMs) {
  next.cleanStreak = 0;
  next.concurrency = 1;
  next.delayMs = Math.min(capMs, Math.max(next.delayMs * 2, next.baseDelayMs + 1000));
  return next;
}

function applyFailureAdaptiveState(next, capMs) {
  next.cleanStreak = 0;
  next.concurrency = Math.max(1, next.concurrency - 1);
  next.delayMs = Math.min(capMs, Math.max(next.delayMs + 250, next.baseDelayMs));
  return next;
}

function computeBackoffWithJitter(attempt, options) {
  const current = options && typeof options === 'object' ? options : {};
  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(0, Math.trunc(attempt)) : 0;
  const baseMs = readBackoffBaseMs(current);
  const capMs = readBackoffCapMs(current, baseMs);
  const exponentialDelay = Math.min(capMs, baseMs * 2 ** normalizedAttempt);

  if (current.jitter === false) {
    return exponentialDelay;
  }

  const boundedRandom = clampRandom(readBackoffRandom(current));

  return Math.max(0, Math.trunc(boundedRandom * exponentialDelay));
}

function readSecureRandomUnit() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const values = new Uint32Array(1);
    cryptoApi.getRandomValues(values);
    return values[0] / RANDOM_UINT32_DENOMINATOR;
  }

  return 0;
}

function nextAdaptiveThrottleState(state, event, options) {
  const currentOptions = options && typeof options === 'object' ? options : {};
  const next = createAdaptiveThrottleState(state);
  const capMs = readAdaptiveCapMs(next, currentOptions);

  if (!next.enabled) {
    return next;
  }

  if (event === 'success') {
    return applySuccessAdaptiveState(next);
  }
  if (event === 'blocked') {
    return applyBlockedAdaptiveState(next, capMs);
  }
  return applyFailureAdaptiveState(next, capMs);
}

function parseRetryAfterMs(value, nowMs) {
  const raw = normalizeSpace(value);
  const baseTime = Number.isFinite(nowMs) ? nowMs : Date.now();
  let seconds;
  let parsedAt;

  if (!raw) {
    return null;
  }

  if (/^\d+$/.test(raw)) {
    seconds = Number.parseInt(raw, 10);
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : null;
  }

  parsedAt = Date.parse(raw);
  if (!Number.isFinite(parsedAt)) {
    return null;
  }

  return Math.max(0, parsedAt - baseTime);
}

function detectPbinfoUserNamespace(root) {
  const anchors = queryAll(root, 'a[href*="/utilizator/"]');
  const positiveContainers = [
    'header',
    'nav',
    '.navbar',
    '#header',
    '.topbar',
    '.user-menu',
    '.account',
  ];
  const negativeContainers = ['main', 'article', '.card', 'table', '.problem-list'];
  let best = null;
  let bestScore = -Infinity;

  anchors.forEach(function (anchor) {
    const href = normalizeSpace(anchor?.href || '');
    const match = /\/utilizator\/(\d+)\/([^/?#]+)/i.exec(href);
    let score = 0;

    if (!match) {
      return;
    }

    positiveContainers.forEach(function (selector) {
      if (hasClosestMatch(anchor, selector)) {
        score += 5;
      }
    });

    negativeContainers.forEach(function (selector) {
      if (hasClosestMatch(anchor, selector)) {
        score -= 4;
      }
    });

    if (score > bestScore) {
      bestScore = score;
      best = match[1] + ':' + match[2];
    }
  });

  return bestScore > 0 ? best : null;
}

module.exports = {
  isLikelyPbinfoNotFoundHtml,
  isLikelyPbinfoBlockedHtml,
  parseTotalProblems,
  normalizeListUrl,
  buildPageUrl,
  computeBackoffWithJitter,
  nextAdaptiveThrottleState,
  parseRetryAfterMs,
  detectPbinfoUserNamespace,
};
