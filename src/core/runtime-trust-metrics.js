const { normalizeSpace } = require('./text-utils');

function isPresent(value) {
  return value !== null && value !== undefined;
}

function buildCoverageText(scannedValue, expectedValue) {
  if (isPresent(expectedValue) && expectedValue > 0) {
    return `${scannedValue}/${expectedValue}`;
  }
  return `${scannedValue}`;
}

function resolveCacheLabel(cacheConfig, parsedCacheState) {
  if (cacheConfig?.enabled === true) {
    if (cacheConfig.forceRefresh) return 'force-refresh';
    if (parsedCacheState?.persistenceEnabled) return `on (${parsedCacheState.hits} hit)`;
    if (parsedCacheState?.userNamespace) return 'memory only';
    return 'waiting user';
  }
  return 'off';
}

function resolvePauseText({
  paused,
  systemPauseReason,
  systemPauseUntil,
  now = Date.now(),
  formatDuration = (value) => `${value}ms`,
}) {
  if (paused && systemPauseReason) {
    let pauseSuffix = '';
    if (isPresent(systemPauseUntil)) {
      const remainingMs = Math.max(0, Number(systemPauseUntil) - Number(now));
      pauseSuffix = ` (${formatDuration(remainingMs)})`;
    }
    return ` · pauză sistem: ${systemPauseReason}${pauseSuffix}`;
  }
  return '';
}

function resolveVerificationLabel(verification) {
  if (verification?.enabled === true) {
    if (verification.running) return 'rulează';
    if (verification.completed) return 'gata';
    return 'pregătită';
  }
  return 'off';
}

function buildTrustMetricsView(context) {
  const coverage = context.coverage;
  const reliability = context.reliability;
  const verification = context.verification;
  const cacheConfig = context.cacheConfig;
  const parsedCacheState = context.parsedCacheState;
  const paused = context.paused;
  const systemPauseReason = context.systemPauseReason;
  const systemPauseUntil = context.systemPauseUntil;
  const now = context.now;
  const formatDuration = context.formatDuration;
  const coveragePagesText = buildCoverageText(coverage.scannedPages, coverage.expectedPages);
  const coverageProblemsText = buildCoverageText(coverage.scannedProblems, coverage.totalProblems);
  let percentText = 'n/a';
  if (isPresent(coverage.percent)) {
    percentText = `${coverage.percent}%`;
  }
  const cacheLabel = resolveCacheLabel(cacheConfig, parsedCacheState);
  const verificationLabel = resolveVerificationLabel(verification);
  const pauseText = resolvePauseText({
    paused,
    systemPauseReason,
    systemPauseUntil,
    now,
    formatDuration,
  });

  const view = {};
  view.coveragePagesText = coveragePagesText;
  view.coverageProblemsText = coverageProblemsText;
  view.percentText = percentText;
  view.cacheLabel = cacheLabel;
  view.verificationLabel = verificationLabel;
  view.pauseText = pauseText;
  view.metricDefinitions = [
    ['Pagini/ținte', coveragePagesText],
    ['Probleme', coverageProblemsText],
    ['Retry-uri', reliability.retryCount],
    ['Necunoscute', reliability.unknowns],
    ['Blocări', reliability.blocked],
    ['429', reliability.rateLimited],
    ['Timeout', reliability.timeout],
    ['Parse fail', reliability.parseFail],
    ['Timp mediu', `${reliability.avgDurationMs}ms`],
    ['Cache', cacheLabel],
    ['Verificare', verificationLabel],
  ];
  return view;
}

function isRetryableOutcomeTarget(targetType, targetKey) {
  if (!Number.isFinite(targetKey)) {
    return false;
  }
  if (targetType === 'verify-problem') {
    return true;
  }
  return targetType === 'list-page' || targetType === 'id-page' || targetType === 'score-batch';
}

function buildOutcomeRetryTargets(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const targets = [];

  for (const entry of list) {
    const targetType = normalizeSpace(entry?.targetType || '');
    const targetKey = Number.parseInt(entry?.targetKey, 10);
    if (isRetryableOutcomeTarget(targetType, targetKey)) {
      targets.push({ targetType, targetKey });
    }
  }

  return targets;
}

module.exports = {
  buildCoverageText,
  resolveCacheLabel,
  resolvePauseText,
  resolveVerificationLabel,
  buildTrustMetricsView,
  buildOutcomeRetryTargets,
};
