const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');

const {
  buildSetupWizardDefaults,
  buildSetupSummaryText,
  resolveSetupWizardResult,
  showSetupWizard,
} = require('../src/core/runtime-storage-setup');
const { readLocalStorageValue, createIndexedDbStorage } = require('../src/core/runtime-storage');

const DEFAULT_LINK = 'https://www.pbinfo.ro/?pagina=probleme-lista';
const LOCATION_REF = { origin: 'https://www.pbinfo.ro' };

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

function createLocalStorage(initialState = {}) {
  const store = new Map(Object.entries(initialState));

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
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

function createOverlayWizardOptions(config, defaults, documentRef, localStorageApi) {
  return {
    defaultLink: DEFAULT_LINK,
    config,
    defaults,
    overlayEnabled: true,
    localStorageApi,
    documentRef,
    locationRef: LOCATION_REF,
    setSelectOptions,
  };
}

function createIndexedDbWithResult(dbResult, overrides = {}) {
  return {
    open() {
      const request = {
        result: dbResult,
        error: overrides.error ?? null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };

      queueMicrotask(function () {
        if (typeof request.onupgradeneeded === 'function' && dbResult != null) {
          request.onupgradeneeded();
        }
        if (overrides.fail && typeof request.onerror === 'function') {
          request.onerror();
          return;
        }
        if (typeof request.onsuccess === 'function') {
          request.onsuccess();
        }
      });

      return request;
    },
  };
}

function resolveWizard(config, overrides = {}) {
  return resolveSetupWizardResult({
    mode: 'list',
    sourceMode: 'current',
    defaultLink: DEFAULT_LINK,
    urlInputValue: '',
    rangeInputValue: '',
    startInputValue: '3',
    speedPresetValue: 'balanced',
    concurrencyInputValue: '',
    delayInputValue: '',
    verifyUnsolved: false,
    forceRefresh: false,
    resumeSavedState: true,
    config,
    locationRef: LOCATION_REF,
    ...overrides,
  });
}

function buildWizardDefaults(config) {
  return buildSetupWizardDefaults({
    setupDefaults: {},
    modeFromWindow: 'list',
    defaultLink: DEFAULT_LINK,
    config,
  });
}

function openOverlayWizard(config, defaults, localStorageApi = createLocalStorage()) {
  const { document } = parseHTML('<html><body></body></html>');
  const promise = showSetupWizard(
    createOverlayWizardOptions(config, defaults, document, localStorageApi)
  );
  return { document, promise };
}

test('runtime storage setup summary includes cache disabled message', () => {
  const config = createConfig();

  assert.match(
    buildSetupSummaryText({
      mode: 'list',
      sourceMode: 'current',
      rangeInputValue: '',
      startPage: '',
      config,
      speedPreset: 'balanced',
      cacheEnabled: false,
      forceRefresh: false,
    }),
    /Cache dezactivat/
  );
});

test('runtime storage setup resolver reports invalid custom start', () => {
  const config = createConfig();

  assert.deepEqual(
    resolveWizard(config, {
      sourceMode: 'custom',
      urlInputValue: 'https://example.invalid/',
      startInputValue: '0',
    }),
    { ok: false, errorText: 'Start invalid.' }
  );
});

test('runtime storage setup resolver reports invalid id range', () => {
  const config = createConfig();

  assert.deepEqual(
    resolveWizard(config, {
      mode: 'id-range',
      rangeInputValue: 'bad-range',
      startInputValue: '10',
    }),
    { ok: false, errorText: 'Interval ID invalid.' }
  );
});

test('runtime storage setup resolver reports invalid link syntax', () => {
  const config = createConfig();

  assert.deepEqual(
    resolveWizard(config, {
      sourceMode: 'custom',
      urlInputValue: 'https://[::1',
      startInputValue: '2',
    }),
    { ok: false, errorText: 'Link invalid.' }
  );
});

test('runtime storage setup branches: wizard cancel and inline validation both resolve safely', async () => {
  const config = createConfig();
  const defaults = buildWizardDefaults(config);

  assert.equal(
    await showSetupWizard({
      defaultLink: DEFAULT_LINK,
      config,
      defaults,
      overlayEnabled: false,
      setSelectOptions,
    }),
    null
  );

  const cancelWizard = openOverlayWizard(config, defaults);
  cancelWizard.document.querySelector('[data-role="setup-cancel"]').click();
  assert.equal(await cancelWizard.promise, null);
  assert.equal(cancelWizard.document.querySelector('[data-role="setup-cancel"]'), null);

  const invalidWizard = openOverlayWizard(config, defaults);
  const startInput = invalidWizard.document.querySelector('[data-role="setup-start"]');
  const startButton = invalidWizard.document.querySelector('[data-role="setup-start-button"]');
  const errorBox = invalidWizard.document.querySelector('[data-role="setup-error"]');

  startInput.value = '0';
  startButton.click();

  assert.equal(errorBox.textContent, 'Start invalid.');
  assert.notEqual(invalidWizard.document.querySelector('[data-role="setup-start-button"]'), null);

  invalidWizard.document.querySelector('[data-role="setup-cancel"]').click();
  assert.equal(await invalidWizard.promise, null);
});

test('runtime storage branches: localStorage and indexeddb fallback paths stay covered', async () => {
  assert.equal(readLocalStorageValue({}, 'missing'), null);

  const nullDbStorage = createIndexedDbStorage({
    indexedDBApi: createIndexedDbWithResult(null),
    localStorageApi: createLocalStorage(),
  });
  assert.equal(await nullDbStorage.openIndexedDb(), null);
  await nullDbStorage.initIndexedDbState(['scan-key']);
  assert.equal(nullDbStorage.state.enabled, false);

  const errorDb = {
    objectStoreNames: {
      contains() {
        return true;
      },
    },
    transaction() {
      return {
        objectStore() {
          return {
            get() {
              const request = { onsuccess: null, onerror: null, error: new Error('read failed') };
              queueMicrotask(function () {
                if (typeof request.onerror === 'function') {
                  request.onerror();
                }
              });
              return request;
            },
          };
        },
      };
    },
  };
  const readErrorStorage = createIndexedDbStorage({
    indexedDBApi: createIndexedDbWithResult(errorDb),
    localStorageApi: createLocalStorage({ 'scan-key': JSON.stringify('legacy-string') }),
  });
  await readErrorStorage.initIndexedDbState([' ', 'scan-key']);
  assert.equal(readErrorStorage.state.enabled, true);
  assert.equal(readErrorStorage.storageGetJson('scan-key'), null);
});
