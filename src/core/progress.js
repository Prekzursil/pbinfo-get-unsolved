function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainderSeconds = seconds % 60;

  if (hours > 0) {
    return (
      hours +
      'h ' +
      String(minutes).padStart(2, '0') +
      'm ' +
      String(remainderSeconds).padStart(2, '0') +
      's'
    );
  }

  if (minutes > 0) {
    return minutes + 'm ' + String(remainderSeconds).padStart(2, '0') + 's';
  }

  return remainderSeconds + 's';
}

function readFiniteValue(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function asPlainObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function isNil(value) {
  return value === null || value === undefined;
}

function buildEtaText(remainingUnits, speed) {
  if (isNil(remainingUnits) || remainingUnits <= 0 || speed <= 0) {
    return '';
  }

  return ' · ETA ~' + formatDuration((remainingUnits / speed) * 1000);
}

function buildAdaptiveText(current) {
  if (!current.adaptiveEnabled) {
    return '';
  }

  const delayMs = readFiniteValue(current.effectiveDelayMs, 0);
  const concurrency = readFiniteValue(current.effectiveConcurrency, 1);

  return ' · throttle delay=' + delayMs + 'ms concurență=' + concurrency;
}

function buildRemainingEtaText(total, completed, speed) {
  if (isNil(total)) {
    return '';
  }

  return buildEtaText(total - completed, speed);
}

function buildIdRangeTotals(config, scanStart) {
  const endId = config?.idRange?.endId ?? Number.NaN;
  return Number.isFinite(endId) ? Math.max(0, endId - scanStart + 1) : null;
}

function buildListTotals(current, scanStart, pagesDone, totalFound) {
  const totalPages = Number.isFinite(current.totalPages)
    ? Math.max(0, current.totalPages - scanStart + 1)
    : Number.NaN;
  const hasTotalProblems = Number.isFinite(current.totalProblems);
  const hasPageSize = Number.isFinite(current.pageSize);
  let totalProblems = Number.NaN;
  if (hasTotalProblems) {
    totalProblems = hasPageSize
      ? Math.max(0, current.totalProblems - current.pageSize * (scanStart - 1))
      : current.totalProblems;
  }
  const hasTotalPages = Number.isFinite(totalPages) && totalPages > 0;
  const hasKnownTotalProblems = Number.isFinite(totalProblems) && totalProblems > 0;
  const pagesText = hasTotalPages ? pagesDone + '/' + totalPages : String(pagesDone);
  const problemsText = hasKnownTotalProblems
    ? totalFound + '/' + totalProblems
    : String(totalFound);

  return [pagesText, problemsText, totalPages];
}

function buildProgressContext(options) {
  const current = asPlainObject(options);
  const config = asPlainObject(current.config);
  const stats = asPlainObject(current.stats);
  const now = readFiniteValue(current.now, Date.now());
  const startedAt = readFiniteValue(current.startedAt, now);
  const elapsedMs = Math.max(0, now - startedAt);
  const scanStart = Math.max(1, readFiniteValue(config.startPage, 1));
  const pagesDone = readFiniteValue(stats.pages, 0);
  const totalFound = readFiniteValue(stats.total, 0);
  const speed = elapsedMs > 0 ? pagesDone / (elapsedMs / 1000) : 0;

  return {
    current,
    config,
    stats,
    elapsedMs,
    scanStart,
    pagesDone,
    totalFound,
    speed,
    pauseText: current.paused ? ' · pauză' : '',
    inFlightText: readFiniteValue(current.inFlight, 0) > 0 ? ' · în lucru ' + current.inFlight : '',
    startText: scanStart > 1 ? ' (de la ' + scanStart + ')' : '',
    adaptiveText: buildAdaptiveText(current),
  };
}

function buildIdRangeProgressText(context) {
  const totalIds = buildIdRangeTotals(context.config, context.scanStart);
  const idsText =
    !isNil(totalIds) && totalIds > 0
      ? context.pagesDone + '/' + totalIds
      : String(context.pagesDone);
  const missingText =
    Number.isFinite(context.stats.missing) && context.stats.missing > 0
      ? ' · 404 ' + context.stats.missing
      : '';
  const forbiddenText =
    Number.isFinite(context.stats.forbidden) && context.stats.forbidden > 0
      ? ' · 403 ' + context.stats.forbidden
      : '';
  const etaText = buildRemainingEtaText(totalIds, context.pagesDone, context.speed);

  return (
    'Progres: ID-uri ' +
    idsText +
    ', probleme ' +
    context.totalFound +
    ' (găsite)' +
    missingText +
    ' · timp ' +
    formatDuration(context.elapsedMs) +
    etaText +
    context.adaptiveText +
    context.pauseText +
    context.inFlightText +
    context.startText +
    forbiddenText
  );
}

function buildListProgressText(context) {
  const [pagesText, problemsText, totalPages] = buildListTotals(
    context.current,
    context.scanStart,
    context.pagesDone,
    context.totalFound
  );
  const etaText = buildRemainingEtaText(totalPages, context.pagesDone, context.speed);

  return (
    'Progres: pagini ' +
    pagesText +
    ', probleme ' +
    problemsText +
    ' · timp ' +
    formatDuration(context.elapsedMs) +
    etaText +
    context.adaptiveText +
    context.pauseText +
    context.inFlightText +
    context.startText
  );
}

function buildProgressText(options) {
  const context = buildProgressContext(options);

  if (context.current.scanMode === 'id-range') {
    return buildIdRangeProgressText(context);
  }

  return buildListProgressText(context);
}

module.exports = {
  formatDuration,
  buildProgressText,
};
