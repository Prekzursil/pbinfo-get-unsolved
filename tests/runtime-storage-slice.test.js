const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');

const {
  formatDateTime,
  buildSetupWizardDefaults,
  parseStartPageInput,
  parseNormalizedIdRangeInput,
  buildIdRangePageLink,
  buildSetupSummaryText,
  resolveSetupWizardResult,
  applyInitialThemePreference,
  showSetupWizard,
} = require('../src/core/runtime-storage-setup');

function createLocalStorage(initialState = {}) {
  const store = new Map(Object.entries(initialState));

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    dump() {
      return Object.fromEntries(store.entries());
    },
  };
}

function setSelectOptions(select, options) {
  select.replaceChildren();
  for (const option of options) {
    const element = select.ownerDocument.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    select.appendChild(element);
  }
}

function createConfig() {
  return {
    startPage: 3,
    concurrency: 2,
    delayMs: 125,
    pagination: {
      param: 'start',
    },
    idRange: {
      startId: 10,
      endId: 20,
    },
    cache: {
      enabled: true,
      forceRefresh: false,
    },
  };
}

test('runtime storage setup helpers build defaults, format dates, and normalize range inputs', () => {
  const config = createConfig();
  const defaults = buildSetupWizardDefaults({
    setupDefaults: { speedPreset: 'fast', resumeSavedState: false },
    modeFromWindow: 'id-range',
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    config,
  });

  assert.equal(defaults.scanMode, 'id-range');
  assert.equal(defaults.pageLink, 'https://www.pbinfo.ro/?pagina=probleme-lista');
  assert.equal(defaults.idRange, '10-20');
  assert.equal(defaults.startPage, 3);
  assert.equal(defaults.speedPreset, 'fast');
  assert.equal(defaults.resumeSavedState, false);
  assert.notEqual(formatDateTime(Date.UTC(2026, 2, 9, 12, 0, 0)), '-');
  assert.equal(formatDateTime('bad-date'), '-');
  assert.equal(parseStartPageInput('', 7), 7);
  assert.equal(parseStartPageInput('0', 7), null);
  assert.deepEqual(parseNormalizedIdRangeInput('20-10', '1-2'), { startId: 10, endId: 20 });
  assert.equal(parseNormalizedIdRangeInput('bad', 'fallback'), null);
  assert.equal(
    buildIdRangePageLink({ origin: 'https://www.pbinfo.ro' }, { startId: 10, endId: 20 }),
    'id-range:https://www.pbinfo.ro:10-20'
  );
  assert.equal(
    buildIdRangePageLink({}, { startId: 1, endId: 2 }),
    'id-range:https://www.pbinfo.ro:1-2'
  );
  assert.deepEqual(
    buildSetupWizardDefaults({
      setupDefaults: [],
      modeFromWindow: '',
      defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
      config,
    }),
    {
      scanMode: 'list',
      pageLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
      idRange: '10-20',
      startPage: 3,
      speedPreset: 'balanced',
      verifyUnsolved: false,
      forceRefresh: false,
      resumeSavedState: true,
      sourceMode: 'current',
    }
  );
});

test('runtime storage setup helpers build summary text and resolve list-mode wizard output', () => {
  const config = createConfig();
  const summary = buildSetupSummaryText({
    mode: 'list',
    sourceMode: 'custom',
    rangeInputValue: '',
    startPage: 5,
    config,
    speedPreset: 'fast',
    cacheEnabled: true,
    forceRefresh: true,
  });
  const resolved = resolveSetupWizardResult({
    mode: 'list',
    sourceMode: 'custom',
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    urlInputValue: 'https://www.pbinfo.ro/?pagina=probleme-lista&start=40',
    rangeInputValue: '',
    startInputValue: '5',
    speedPresetValue: 'fast',
    concurrencyInputValue: '',
    delayInputValue: '',
    verifyUnsolved: true,
    forceRefresh: true,
    resumeSavedState: false,
    config,
    locationRef: { origin: 'https://www.pbinfo.ro' },
  });

  assert.match(summary, /link-ul furnizat/);
  assert.match(summary, /Cache bypass/);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.result.scanMode, 'list');
  assert.equal(resolved.result.pageLink, 'https://www.pbinfo.ro/?pagina=probleme-lista');
  assert.equal(resolved.result.speedPreset, 'fast');
  assert.equal(resolved.result.concurrency, 2);
  assert.equal(resolved.result.delayMs, 0);
  assert.equal(resolved.result.verifyUnsolved, true);
  assert.equal(
    resolved.rememberedPreferences.pageLink,
    'https://www.pbinfo.ro/?pagina=probleme-lista'
  );
});

test('runtime storage setup helpers resolve id-range validation and theme initialization', () => {
  const config = createConfig();
  const invalid = resolveSetupWizardResult({
    mode: 'id-range',
    sourceMode: 'current',
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    urlInputValue: '',
    rangeInputValue: '10-20',
    startInputValue: '21',
    speedPresetValue: 'balanced',
    concurrencyInputValue: '3',
    delayInputValue: '15',
    verifyUnsolved: false,
    forceRefresh: false,
    resumeSavedState: true,
    config,
    locationRef: { origin: 'https://www.pbinfo.ro' },
  });
  const valid = resolveSetupWizardResult({
    mode: 'id-range',
    sourceMode: 'current',
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    urlInputValue: '',
    rangeInputValue: '20-10',
    startInputValue: '12',
    speedPresetValue: 'balanced',
    concurrencyInputValue: '3',
    delayInputValue: '15',
    verifyUnsolved: false,
    forceRefresh: false,
    resumeSavedState: true,
    config,
    locationRef: { origin: 'https://www.pbinfo.ro' },
  });
  const localStorageApi = createLocalStorage({
    'pbinfo-get-unsolved:theme': 'dark',
  });
  const appRoot = {
    dataset: {},
    setAttribute() {},
    removeAttribute() {},
  };
  const documentElement = {
    dataset: {},
    setAttribute() {},
    removeAttribute() {},
  };

  assert.deepEqual(invalid, {
    ok: false,
    errorText: 'Start-ul depășește capătul intervalului.',
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.result.idRange, { startId: 10, endId: 20 });
  assert.equal(valid.result.pageLink, 'id-range:https://www.pbinfo.ro:10-20');
  assert.equal(valid.result.concurrency, 3);
  assert.equal(valid.result.delayMs, 15);
  assert.equal(applyInitialThemePreference({ localStorageApi, appRoot, documentElement }), 'dark');
  assert.equal(appRoot.dataset.theme, 'dark');
});

test('runtime storage setup helpers reject invalid summary and wizard input branches', async () => {
  const config = createConfig();
  const disabledSummary = buildSetupSummaryText({
    mode: 'id-range',
    sourceMode: 'current',
    rangeInputValue: '',
    startPage: '',
    config,
    speedPreset: 'missing',
    cacheEnabled: false,
    forceRefresh: false,
  });
  const invalidStart = resolveSetupWizardResult({
    mode: 'list',
    sourceMode: 'current',
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    urlInputValue: '',
    rangeInputValue: '',
    startInputValue: '0',
    speedPresetValue: 'balanced',
    concurrencyInputValue: '',
    delayInputValue: '',
    verifyUnsolved: false,
    forceRefresh: false,
    resumeSavedState: true,
    config,
    locationRef: { origin: 'https://www.pbinfo.ro' },
  });
  const invalidRange = resolveSetupWizardResult({
    mode: 'id-range',
    sourceMode: 'current',
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    urlInputValue: '',
    rangeInputValue: 'bad',
    startInputValue: '1',
    speedPresetValue: 'balanced',
    concurrencyInputValue: '',
    delayInputValue: '',
    verifyUnsolved: false,
    forceRefresh: false,
    resumeSavedState: true,
    config,
    locationRef: { origin: 'https://www.pbinfo.ro' },
  });
  const invalidLink = resolveSetupWizardResult({
    mode: 'list',
    sourceMode: 'custom',
    defaultLink: '',
    urlInputValue: '::::',
    rangeInputValue: '',
    startInputValue: '3',
    speedPresetValue: 'balanced',
    concurrencyInputValue: '',
    delayInputValue: '',
    verifyUnsolved: false,
    forceRefresh: false,
    resumeSavedState: true,
    config,
    locationRef: { origin: 'https://www.pbinfo.ro' },
  });
  const hiddenWizard = await showSetupWizard({
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    config,
    defaults: buildSetupWizardDefaults({
      setupDefaults: {},
      modeFromWindow: 'list',
      defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
      config,
    }),
    overlayEnabled: false,
    setSelectOptions,
  });

  assert.match(disabledSummary, /intervalul 10-20/);
  assert.match(disabledSummary, /Cache dezactivat/);
  assert.deepEqual(invalidStart, { ok: false, errorText: 'Start invalid.' });
  assert.deepEqual(invalidRange, { ok: false, errorText: 'Interval ID invalid.' });
  assert.deepEqual(invalidLink, { ok: false, errorText: 'Link invalid.' });
  assert.equal(hiddenWizard, null);
});

test('runtime storage setup wizard returns saved selections through the extracted module', async () => {
  const { document, window } = parseHTML('<html><body></body></html>');
  const localStorageApi = createLocalStorage();
  const config = createConfig();
  const promise = showSetupWizard({
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    config,
    defaults: buildSetupWizardDefaults({
      setupDefaults: {},
      modeFromWindow: 'list',
      defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
      config,
    }),
    overlayEnabled: true,
    localStorageApi,
    documentRef: document,
    locationRef: { origin: 'https://www.pbinfo.ro' },
    setSelectOptions,
  });
  const modeSelect = document.querySelector('[data-role="setup-mode"]');
  const rangeInput = document.querySelector('[data-role="setup-range"]');
  const startInput = document.querySelector('[data-role="setup-start"]');
  const speedSelect = document.querySelector('[data-role="setup-speed"]');
  const forceRefreshCheck = document.querySelector('[data-role="setup-force-refresh"]');
  const startButton = document.querySelector('[data-role="setup-start-button"]');

  modeSelect.options[1].selected = true;
  modeSelect.dispatchEvent(new window.Event('change'));
  rangeInput.value = '25-20';
  rangeInput.dispatchEvent(new window.Event('input'));
  startInput.value = '21';
  startInput.dispatchEvent(new window.Event('input'));
  speedSelect.options[2].selected = true;
  speedSelect.dispatchEvent(new window.Event('change'));
  forceRefreshCheck.checked = true;
  forceRefreshCheck.dispatchEvent(new window.Event('change'));
  startButton.click();

  const result = await promise;

  assert.deepEqual(result, {
    scanMode: 'id-range',
    pageLink: 'id-range:https://www.pbinfo.ro:20-25',
    startPage: 21,
    idRange: { startId: 20, endId: 25 },
    verifyUnsolved: false,
    forceRefresh: true,
    resumeSavedState: true,
    speedPreset: 'fast',
    concurrency: 2,
    delayMs: 125,
    sourceMode: 'current',
  });
  assert.equal(document.querySelector('[data-role="setup-start-button"]'), null);
  assert.match(localStorageApi.dump()['pbinfo-get-unsolved:setup-prefs'], /"idRange":"20-25"/);
});

test('runtime storage setup wizard keeps modal open on validation errors and closes on cancel', async () => {
  const { document, window } = parseHTML('<html><body></body></html>');
  const config = createConfig();
  const promise = showSetupWizard({
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    config,
    defaults: buildSetupWizardDefaults({
      setupDefaults: {},
      modeFromWindow: 'list',
      defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
      config,
    }),
    overlayEnabled: true,
    localStorageApi: createLocalStorage(),
    documentRef: document,
    locationRef: { origin: 'https://www.pbinfo.ro' },
    setSelectOptions,
  });
  const modeSelect = document.querySelector('[data-role="setup-mode"]');
  const rangeInput = document.querySelector('[data-role="setup-range"]');
  const startInput = document.querySelector('[data-role="setup-start"]');
  const startButton = document.querySelector('[data-role="setup-start-button"]');
  const cancelButton = document.querySelector('[data-role="setup-cancel"]');
  const errorBox = document.querySelector('[data-role="setup-error"]');

  modeSelect.options[1].selected = true;
  modeSelect.dispatchEvent(new window.Event('change'));
  rangeInput.value = 'bad';
  rangeInput.dispatchEvent(new window.Event('input'));
  startInput.value = '1';
  startInput.dispatchEvent(new window.Event('input'));
  startButton.click();

  assert.equal(errorBox.textContent, 'Interval ID invalid.');
  assert.notEqual(document.querySelector('[data-role="setup-start-button"]'), null);

  cancelButton.click();

  assert.equal(await promise, null);
  assert.equal(document.querySelector('[data-role="setup-cancel"]'), null);
});
