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
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    config,
    defaults,
    overlayEnabled: true,
    localStorageApi,
    documentRef,
    locationRef: { origin: 'https://www.pbinfo.ro' },
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

test('runtime storage setup branches: summary and resolver error paths stay explicit', () => {
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

  assert.deepEqual(
    resolveSetupWizardResult({
      mode: 'list',
      sourceMode: 'custom',
      defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
      urlInputValue: 'https://example.invalid/',
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
    }),
    { ok: false, errorText: 'Start invalid.' }
  );

  assert.deepEqual(
    resolveSetupWizardResult({
      mode: 'id-range',
      sourceMode: 'current',
      defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
      urlInputValue: '',
      rangeInputValue: 'bad-range',
      startInputValue: '10',
      speedPresetValue: 'balanced',
      concurrencyInputValue: '',
      delayInputValue: '',
      verifyUnsolved: false,
      forceRefresh: false,
      resumeSavedState: true,
      config,
      locationRef: { origin: 'https://www.pbinfo.ro' },
    }),
    { ok: false, errorText: 'Interval ID invalid.' }
  );

  assert.deepEqual(
    resolveSetupWizardResult({
      mode: 'list',
      sourceMode: 'custom',
      defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
      urlInputValue: 'https://[::1',
      rangeInputValue: '',
      startInputValue: '2',
      speedPresetValue: 'balanced',
      concurrencyInputValue: '',
      delayInputValue: '',
      verifyUnsolved: false,
      forceRefresh: false,
      resumeSavedState: true,
      config,
      locationRef: { origin: 'https://www.pbinfo.ro' },
    }),
    { ok: false, errorText: 'Link invalid.' }
  );
});

test('runtime storage setup branches: wizard cancel and inline validation both resolve safely', async () => {
  const config = createConfig();
  const defaults = buildSetupWizardDefaults({
    setupDefaults: {},
    modeFromWindow: 'list',
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    config,
  });

  assert.equal(
    await showSetupWizard({
      defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
      config,
      defaults,
      overlayEnabled: false,
      setSelectOptions,
    }),
    null
  );

  {
    const { document } = parseHTML('<html><body></body></html>');
    const promise = showSetupWizard(
      createOverlayWizardOptions(config, defaults, document, createLocalStorage())
    );

    document.querySelector('[data-role="setup-cancel"]').click();
    assert.equal(await promise, null);
    assert.equal(document.querySelector('[data-role="setup-cancel"]'), null);
  }

  {
    const { document } = parseHTML('<html><body></body></html>');
    const promise = showSetupWizard(
      createOverlayWizardOptions(config, defaults, document, createLocalStorage())
    );
    const startInput = document.querySelector('[data-role="setup-start"]');
    const startButton = document.querySelector('[data-role="setup-start-button"]');
    const errorBox = document.querySelector('[data-role="setup-error"]');

    startInput.value = '0';
    startButton.click();

    assert.equal(errorBox.textContent, 'Start invalid.');
    assert.notEqual(document.querySelector('[data-role="setup-start-button"]'), null);

    document.querySelector('[data-role="setup-cancel"]').click();
    assert.equal(await promise, null);
  }
});

test('runtime storage branches: localStorage and indexeddb fallback paths stay covered', async () => {
  assert.equal(readLocalStorageValue({}, 'missing'), null);

  const nullOptionsStorage = createIndexedDbStorage(null);
  assert.equal(await nullOptionsStorage.openIndexedDb(), null);
  assert.equal(nullOptionsStorage.storageHasValue('missing-key'), false);

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
