const { normalizeSpace } = require('./text-utils');
const { normalizeListUrl } = require('./network');
const {
  getSpeedPresetConfig,
  loadThemePreference,
  applyThemePreference,
  parseIdRangeInput,
} = require('./runtime-setup');

function formatDateTime(ts) {
  const date = new Date(Number(ts));

  if (!Number.isFinite(date.getTime())) {
    return '-';
  }

  return date.toLocaleString();
}

function buildSetupWizardDefaults({ setupDefaults, modeFromWindow, defaultLink, config }) {
  const defaults =
    setupDefaults !== null &&
    !Array.isArray(setupDefaults) &&
    Object(setupDefaults) === setupDefaults
      ? setupDefaults
      : {};

  return {
    scanMode: defaults.scanMode || modeFromWindow || 'list',
    pageLink: defaults.pageLink || defaultLink,
    idRange: defaults.idRange || `${config.idRange.startId}-${config.idRange.endId}`,
    startPage: defaults.startPage || config.startPage,
    speedPreset: defaults.speedPreset || 'balanced',
    verifyUnsolved: defaults.verifyUnsolved === true,
    forceRefresh: defaults.forceRefresh === true || config.cache.forceRefresh,
    resumeSavedState: defaults.resumeSavedState !== false,
    sourceMode: defaults.sourceMode || 'current',
  };
}

function parseStartPageInput(value, fallback) {
  const rawValue = normalizeSpace(value);
  const candidate = rawValue === '' ? fallback : rawValue;
  const parsedValue = Number.parseInt(candidate, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return null;
  }

  return parsedValue;
}

function parseNormalizedIdRangeInput(value, fallback) {
  const parsedRange = parseIdRangeInput(value, fallback);

  if (parsedRange == null) {
    return null;
  }

  return {
    startId: Math.min(parsedRange.startId, parsedRange.endId),
    endId: Math.max(parsedRange.startId, parsedRange.endId),
  };
}

function buildIdRangePageLink(locationRef, idRange) {
  return `id-range:${locationRef?.origin || 'https://www.pbinfo.ro'}:${idRange.startId}-${idRange.endId}`;
}

function buildSetupSummaryText({
  mode,
  sourceMode,
  rangeInputValue,
  startPage,
  config,
  speedPreset,
  cacheEnabled,
  forceRefresh,
}) {
  const speed = getSpeedPresetConfig(speedPreset);
  const startLabel = startPage || config.startPage;
  const rangeLabel =
    normalizeSpace(rangeInputValue) || `${config.idRange.startId}-${config.idRange.endId}`;
  const scanTargetLabel = sourceMode === 'custom' ? 'link-ul furnizat' : 'pagina curentă';
  let cacheLabel = 'activ';
  let prefix = `Va scana ${scanTargetLabel}`;

  if (!cacheEnabled) {
    cacheLabel = 'dezactivat';
  } else if (forceRefresh) {
    cacheLabel = 'bypass';
  }

  if (mode === 'id-range') {
    prefix = `Va scana intervalul ${rangeLabel}`;
  }

  return (
    `${prefix} de la ${startLabel}. Preset ${speed.preset}: delay ${speed.delayMs}ms, ` +
    `concurență ${speed.concurrency}. Cache ${cacheLabel}.`
  );
}

function resolveIdRangeWizardTarget({ rangeInputValue, config, startPage, locationRef }) {
  const idRange = parseNormalizedIdRangeInput(
    rangeInputValue,
    `${config.idRange.startId}-${config.idRange.endId}`
  );

  if (idRange == null) {
    return { ok: false, errorText: 'Interval ID invalid.' };
  }

  if (startPage > idRange.endId) {
    return { ok: false, errorText: 'Start-ul depășește capătul intervalului.' };
  }

  return {
    ok: true,
    pageLink: buildIdRangePageLink(locationRef, idRange),
    idRange,
  };
}

function resolveListWizardTarget({ sourceMode, urlInputValue, defaultLink, config }) {
  const pageLink = normalizeListUrl(
    sourceMode === 'custom' ? urlInputValue : defaultLink,
    defaultLink,
    config.pagination.param
  );

  if (!pageLink) {
    return { ok: false, errorText: 'Link invalid.' };
  }

  return {
    ok: true,
    pageLink,
    idRange: null,
  };
}

function resolveWizardTarget(options) {
  if (options.mode === 'id-range') {
    return resolveIdRangeWizardTarget(options);
  }

  return resolveListWizardTarget(options);
}

function parseWizardNumericInput(value, fallback, minValue) {
  const parsed = Number.parseInt(value || String(fallback), 10);
  const normalized = parsed || fallback;
  return Math.max(minValue, normalized);
}

function buildRememberedWizardPreferences({ result, mode, pageLink, defaultLink, idRange }) {
  return {
    scanMode: result.scanMode,
    pageLink: mode === 'list' ? pageLink : defaultLink,
    idRange: idRange ? `${idRange.startId}-${idRange.endId}` : '',
    startPage: result.startPage,
    speedPreset: result.speedPreset,
    verifyUnsolved: result.verifyUnsolved,
    forceRefresh: result.forceRefresh,
    resumeSavedState: result.resumeSavedState,
    sourceMode: result.sourceMode,
  };
}

function resolveSetupWizardResult({
  mode,
  sourceMode,
  defaultLink,
  urlInputValue,
  rangeInputValue,
  startInputValue,
  speedPresetValue,
  concurrencyInputValue,
  delayInputValue,
  verifyUnsolved,
  forceRefresh,
  resumeSavedState,
  config,
  locationRef = globalThis.location,
}) {
  const startPage = parseStartPageInput(startInputValue, config.startPage || 1);

  if (startPage == null) {
    return { ok: false, errorText: 'Start invalid.' };
  }

  const target = resolveWizardTarget({
    mode,
    sourceMode,
    urlInputValue,
    rangeInputValue,
    defaultLink,
    config,
    startPage,
    locationRef,
  });

  if (!target.ok) {
    return target;
  }

  const speed = getSpeedPresetConfig(speedPresetValue);
  const result = {
    scanMode: mode,
    pageLink: target.pageLink,
    startPage,
    idRange: target.idRange,
    verifyUnsolved: verifyUnsolved === true,
    forceRefresh: forceRefresh === true,
    resumeSavedState: resumeSavedState === true,
    speedPreset: speed.preset,
    concurrency: parseWizardNumericInput(concurrencyInputValue, speed.concurrency, 1),
    delayMs: parseWizardNumericInput(delayInputValue, speed.delayMs, 0),
    sourceMode: sourceMode === 'custom' ? 'custom' : 'current',
  };

  return {
    ok: true,
    result,
    rememberedPreferences: buildRememberedWizardPreferences({
      result,
      mode,
      pageLink: target.pageLink,
      defaultLink,
      idRange: target.idRange,
    }),
  };
}

function applyInitialThemePreference({ localStorageApi, appRoot, documentElement }) {
  const storedTheme = loadThemePreference(localStorageApi);

  return applyThemePreference(storedTheme, appRoot, {
    localStorageApi,
    fallbackTarget: documentElement,
  });
}

module.exports = {
  formatDateTime,
  buildSetupWizardDefaults,
  parseStartPageInput,
  parseNormalizedIdRangeInput,
  buildIdRangePageLink,
  buildSetupSummaryText,
  resolveSetupWizardResult,
  applyInitialThemePreference,
};
