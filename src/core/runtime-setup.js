const { normalizeSpace, normalizeForMatch } = require('./text-utils');
const { STORAGE_NAMESPACE, safeJsonParse } = require('./runtime-storage');

const THEME_STORAGE_KEY = `${STORAGE_NAMESPACE}:theme`;
const SETUP_PREFS_STORAGE_KEY = `${STORAGE_NAMESPACE}:setup-prefs`;
const DEFAULT_THEME_PREFERENCE = 'system';
const VALID_THEME_PREFERENCES = new Set(['light', 'dark', DEFAULT_THEME_PREFERENCE]);

function isBrowserRuntimeAvailable(runtime = globalThis) {
  return runtime?.window != null && runtime?.document != null;
}

function isPlainRecord(value) {
  return value !== null && !Array.isArray(value) && Object(value) === value;
}

function hasStorageMethod(localStorageApi, methodName) {
  return typeof localStorageApi?.[methodName] === 'function';
}

function readLocalStorageValue(localStorageApi, key) {
  if (!hasStorageMethod(localStorageApi, 'getItem')) {
    return null;
  }

  try {
    return localStorageApi.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorageValue(localStorageApi, key, value) {
  if (!hasStorageMethod(localStorageApi, 'setItem')) {
    return;
  }

  try {
    localStorageApi.setItem(key, value);
  } catch {}
}

function getSpeedPresetConfig(preset) {
  const normalized = normalizeForMatch(preset || '');

  if (normalized === 'safe') {
    return { preset: 'safe', concurrency: 1, delayMs: 250 };
  }

  if (normalized === 'fast') {
    return { preset: 'fast', concurrency: 2, delayMs: 0 };
  }

  return { preset: 'balanced', concurrency: 1, delayMs: 100 };
}

function normalizeScanMode(value) {
  const normalized = normalizeForMatch(value || '');

  if (normalized === '1') {
    return 'list';
  }

  if (normalized === '2') {
    return 'id-range';
  }

  if (normalized.includes('id') || normalized.includes('range') || normalized.includes('index')) {
    return 'id-range';
  }

  if (normalized.includes('list')) {
    return 'list';
  }

  return null;
}

function styleWizardControl(control) {
  control.style.border = '1px solid #cbd5e1';
  control.style.borderRadius = '10px';
  control.style.padding = '9px 11px';
  control.style.fontSize = '14px';
  control.style.width = '100%';
  control.style.boxSizing = 'border-box';
  return control;
}

function normalizeThemePreference(value) {
  return VALID_THEME_PREFERENCES.has(value) ? value : DEFAULT_THEME_PREFERENCE;
}

function loadThemePreference(localStorageApi = globalThis.localStorage) {
  const storedValue = normalizeSpace(readLocalStorageValue(localStorageApi, THEME_STORAGE_KEY));
  return normalizeThemePreference(storedValue);
}

function persistThemePreference(value, localStorageApi = globalThis.localStorage) {
  writeLocalStorageValue(localStorageApi, THEME_STORAGE_KEY, value);
  return value;
}

function hasDataset(target) {
  return target?.dataset != null && Object(target.dataset) === target.dataset;
}

function hasAttributeMap(target) {
  return target?.attributes != null && Object(target.attributes) === target.attributes;
}

function resolveThemeTarget(targetEl, fallbackTarget) {
  if (hasDataset(targetEl) || hasAttributeMap(targetEl)) {
    return targetEl;
  }

  if (hasDataset(fallbackTarget) || hasAttributeMap(fallbackTarget)) {
    return fallbackTarget;
  }

  return null;
}

function applyThemeValueToTarget(target, normalizedValue) {
  if (hasDataset(target)) {
    if (normalizedValue === 'system') {
      delete target.dataset.theme;
      return;
    }
    target.dataset.theme = normalizedValue;
    return;
  }

  if (normalizedValue === 'system') {
    delete target.attributes['data-theme'];
    return;
  }
  target.attributes['data-theme'] = normalizedValue;
}

function applyThemePreference(value, targetEl, options = {}) {
  const localStorageApi = options.localStorageApi ?? globalThis.localStorage ?? null;
  const fallbackTarget = options.fallbackTarget ?? null;
  const target = resolveThemeTarget(targetEl, fallbackTarget);
  const normalizedValue = normalizeThemePreference(value);

  if (target != null) {
    applyThemeValueToTarget(target, normalizedValue);
  }

  persistThemePreference(normalizedValue, localStorageApi);
  return normalizedValue;
}

function loadSetupPreferences(localStorageApi = globalThis.localStorage) {
  const parsed = safeJsonParse(readLocalStorageValue(localStorageApi, SETUP_PREFS_STORAGE_KEY));
  return isPlainRecord(parsed) ? parsed : {};
}

function saveSetupPreferences(value, localStorageApi = globalThis.localStorage) {
  const normalizedValue = isPlainRecord(value) ? value : {};
  writeLocalStorageValue(localStorageApi, SETUP_PREFS_STORAGE_KEY, JSON.stringify(normalizedValue));
}

function parsePositiveInteger(value) {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return null;
  }

  return parsedValue;
}

function parseIdRangeInput(value, fallback) {
  const rawValue = normalizeSpace(value);
  const fallbackValue = normalizeSpace(fallback);
  const normalizedValue = rawValue || fallbackValue;

  if (!normalizedValue) {
    return null;
  }

  const match = /^(\d+)\s*-\s*(\d+)$/.exec(normalizedValue);
  if (match) {
    const startId = parsePositiveInteger(match[1]);
    const endId = parsePositiveInteger(match[2]);

    if (startId == null || endId == null) {
      return null;
    }

    return { startId, endId };
  }

  const endId = parsePositiveInteger(normalizedValue);
  if (endId == null) {
    return null;
  }

  return { startId: 1, endId };
}

module.exports = {
  THEME_STORAGE_KEY,
  SETUP_PREFS_STORAGE_KEY,
  isBrowserRuntimeAvailable,
  isPlainRecord,
  hasStorageMethod,
  readLocalStorageValue,
  writeLocalStorageValue,
  getSpeedPresetConfig,
  normalizeScanMode,
  styleWizardControl,
  loadThemePreference,
  persistThemePreference,
  resolveThemeTarget,
  applyThemePreference,
  loadSetupPreferences,
  saveSetupPreferences,
  parsePositiveInteger,
  parseIdRangeInput,
};
