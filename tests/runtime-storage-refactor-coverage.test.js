const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');

const {
  buildSetupWizardDefaults,
  buildIdRangePageLink,
  resolveSetupWizardResult,
  showSetupWizard,
} = require('../src/core/runtime-storage-setup');
const { fnv1a32, createIndexedDbStorage } = require('../src/core/runtime-storage');

function createConfig(overrides = {}) {
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
    ...overrides,
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

function createOverlayWizardOptions(
  config,
  defaults,
  documentRef,
  localStorageApi,
  locationRef = {}
) {
  return {
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    config,
    defaults,
    overlayEnabled: true,
    localStorageApi,
    documentRef,
    locationRef,
    setSelectOptions,
  };
}

function createIndexedDbApi(db) {
  return {
    open() {
      const request = {
        result: db,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(function () {
        if (typeof request.onupgradeneeded === 'function') {
          request.onupgradeneeded();
        }
        if (typeof request.onsuccess === 'function') {
          request.onsuccess();
        }
      });
      return request;
    },
  };
}

async function withGlobalLocalStorage(localStorageApi, callback) {
  const previousLocalStorage = globalThis.localStorage;
  globalThis.localStorage = localStorageApi;

  try {
    await callback();
  } finally {
    if (previousLocalStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = previousLocalStorage;
    }
  }
}

function getDefaultListLink() {
  return 'https://www.pbinfo.ro/?pagina=probleme-lista';
}

function buildResolverFallbackScenario() {
  const config = createConfig({ startPage: 0 });
  const defaultLink = getDefaultListLink();
  const baseResolverInput = {
    sourceMode: 'current',
    defaultLink,
    urlInputValue: '',
    rangeInputValue: '',
    startInputValue: '',
    verifyUnsolved: false,
    forceRefresh: false,
    config,
    locationRef: {},
  };

  return {
    defaultLink,
    defaults: buildSetupWizardDefaults({
      setupDefaults: [],
      modeFromWindow: '',
      defaultLink,
      config,
    }),
    resolvedList: resolveSetupWizardResult({
      ...baseResolverInput,
      mode: 'list',
      speedPresetValue: 'safe',
      concurrencyInputValue: '0',
      delayInputValue: '-5',
      resumeSavedState: true,
    }),
    resolvedRange: resolveSetupWizardResult({
      ...baseResolverInput,
      mode: 'id-range',
      speedPresetValue: '',
      concurrencyInputValue: '',
      delayInputValue: '',
      resumeSavedState: false,
    }),
  };
}

function assertResolverFallbackScenario({ defaultLink, defaults, resolvedList, resolvedRange }) {
  assert.equal(defaults.scanMode, 'list');
  assert.equal(defaults.pageLink, defaultLink);
  assert.equal(defaults.idRange, '10-20');
  assert.equal(defaults.startPage, 0);
  assert.equal(
    buildIdRangePageLink({}, { startId: 10, endId: 20 }),
    'id-range:https://www.pbinfo.ro:10-20'
  );

  assert.equal(resolvedList.ok, true);
  assert.equal(resolvedList.result.pageLink, defaultLink);
  assert.equal(resolvedList.result.startPage, 1);
  assert.equal(resolvedList.result.concurrency, 1);
  assert.equal(resolvedList.result.delayMs, 0);
  assert.equal(resolvedList.result.sourceMode, 'current');
  assert.equal(resolvedRange.ok, true);
  assert.equal(resolvedRange.result.pageLink, 'id-range:https://www.pbinfo.ro:10-20');
  assert.equal(resolvedRange.rememberedPreferences.pageLink, defaultLink);
}

function querySetupWizardElements(document) {
  return {
    modeSelect: document.querySelector('[data-role="setup-mode"]'),
    sourceSelect: document.querySelector('[data-role="setup-source"]'),
    urlInput: document.querySelector('[data-role="setup-url"]'),
    rangeInput: document.querySelector('[data-role="setup-range"]'),
    startInput: document.querySelector('[data-role="setup-start"]'),
    speedSelect: document.querySelector('[data-role="setup-speed"]'),
    summary: document.querySelector('[data-role="setup-summary"]'),
  };
}

function selectOption(select, index, window) {
  select.options[index].selected = true;
  select.dispatchEvent(new window.Event('change'));
}

function assertWizardInitialVisibility({ urlInput, rangeInput, startInput, summary }) {
  assert.equal(urlInput.parentElement.style.display, 'none');
  assert.equal(rangeInput.parentElement.style.display, 'none');
  assert.equal(startInput.value, '3');
  assert.match(summary.textContent, /pagina curentă/);
}

function assertWizardModeAndSourceToggles(elements, window) {
  const { modeSelect, sourceSelect, urlInput, rangeInput, speedSelect, summary } = elements;

  selectOption(modeSelect, 1, window);
  assert.equal(rangeInput.parentElement.style.display, '');
  assert.match(summary.textContent, /intervalul 10-20/);

  selectOption(modeSelect, 0, window);
  selectOption(sourceSelect, 0, window);
  assert.equal(urlInput.parentElement.style.display, 'none');

  selectOption(sourceSelect, 1, window);
  assert.equal(urlInput.parentElement.style.display, '');
  selectOption(speedSelect, 0, window);
  assert.match(summary.textContent, /link-ul furnizat/);
}

async function runWizardIdRangeAndCustomSourceScenario() {
  const { document, window } = parseHTML('<html><body></body></html>');
  const localStorageApi = createLocalStorage();
  const config = createConfig();
  const defaults = buildSetupWizardDefaults({
    setupDefaults: {
      scanMode: 'id-range',
      sourceMode: 'custom',
      pageLink: '',
      idRange: '',
      startPage: 0,
      speedPreset: 'safe',
      verifyUnsolved: true,
      forceRefresh: false,
      resumeSavedState: false,
    },
    modeFromWindow: '',
    defaultLink: getDefaultListLink(),
    config,
  });
  const promise = showSetupWizard(
    createOverlayWizardOptions(config, defaults, document, localStorageApi)
  );
  const elements = querySetupWizardElements(document);

  assertWizardInitialVisibility(elements);
  assertWizardModeAndSourceToggles(elements, window);

  document.querySelector('[data-role="setup-cancel"]').click();
  assert.equal(await promise, null);
  assert.equal(localStorageApi.dump()['pbinfo-get-unsolved:setup-prefs'], undefined);
}

test('runtime storage refactor coverage: defaults and resolver fallbacks stay explicit', function defaultsAndResolverFallbacksStayExplicit() {
  assertResolverFallbackScenario(buildResolverFallbackScenario());
});

test('runtime storage refactor coverage: wizard populates id-range and custom-source states', async function wizardPopulatesIdRangeAndCustomSourceStates() {
  await runWizardIdRangeAndCustomSourceScenario();
});

test('runtime storage refactor coverage: indexeddb bootstrap covers null backends and scalar hydration keys', async () => {
  const db = {
    objectStoreNames: {
      contains() {
        return true;
      },
    },
    createObjectStore() {},
    transaction() {
      return {
        objectStore() {
          return {
            get() {
              const request = { onsuccess: null, onerror: null, result: null, error: null };
              queueMicrotask(function () {
                request.result = null;
                if (typeof request.onsuccess === 'function') {
                  request.onsuccess();
                }
              });
              return request;
            },
            put() {},
          };
        },
      };
    },
  };

  const noBackendStorage = createIndexedDbStorage({
    indexedDBApi: null,
    localStorageApi: createLocalStorage(),
  });
  const hydratedStorage = createIndexedDbStorage({
    indexedDBApi: createIndexedDbApi(db),
    localStorageApi: createLocalStorage({
      'scan-key': JSON.stringify({ savedAt: 1 }),
    }),
    databaseVersion: Number.NaN,
  });

  assert.equal(fnv1a32(), '811c9dc5');
  assert.equal(await noBackendStorage.openIndexedDb(), null);
  await hydratedStorage.initIndexedDbState('scan-key');
  assert.equal(hydratedStorage.state.enabled, true);
  assert.deepEqual(hydratedStorage.storageGetJson('scan-key'), { savedAt: 1 });
});

test('runtime storage refactor coverage: wizard honors explicit defaults and custom indexeddb config', async function wizardHonorsExplicitDefaultsAndCustomIndexedDbConfig() {
  const recordedOpenCalls = [];
  const { document, window } = parseHTML('<html><body></body></html>');
  const globalStorage = createLocalStorage();
  const db = {
    objectStoreNames: {
      contains() {
        return true;
      },
    },
    createObjectStore() {},
  };
  const storage = createIndexedDbStorage({
    indexedDBApi: {
      open(name, version) {
        recordedOpenCalls.push({ name, version });
        return createIndexedDbApi(db).open();
      },
    },
    databaseName: 'custom-db',
    databaseVersion: 7,
  });

  await withGlobalLocalStorage(globalStorage, async function () {
    const promise = showSetupWizard({
      defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
      config: createConfig(),
      defaults: {
        scanMode: 'list',
        sourceMode: 'custom',
        pageLink: 'https://www.pbinfo.ro/?pagina=probleme-lista&tag=2',
        idRange: '44-55',
        startPage: 9,
        speedPreset: 'fast',
        verifyUnsolved: false,
        forceRefresh: false,
        resumeSavedState: true,
      },
      overlayEnabled: true,
      documentRef: document,
      locationRef: { origin: 'https://www.pbinfo.ro' },
      setSelectOptions,
    });

    const sourceSelect = document.querySelector('[data-role="setup-source"]');
    assert.equal(
      document.querySelector('[data-role="setup-url"]').value,
      'https://www.pbinfo.ro/?pagina=probleme-lista&tag=2'
    );
    assert.equal(document.querySelector('[data-role="setup-range"]').value, '44-55');
    assert.equal(document.querySelector('[data-role="setup-start"]').value, '9');
    assert.match(
      document.querySelector('[data-role="setup-summary"]').textContent,
      /pagina curentă/
    );

    sourceSelect.options[1].selected = true;
    sourceSelect.dispatchEvent(new window.Event('change'));

    document.querySelector('[data-role="setup-start"]').value = '';
    document.querySelector('[data-role="setup-start"]').dispatchEvent(new window.Event('input'));
    assert.match(document.querySelector('[data-role="setup-summary"]').textContent, /de la 3\./);

    document.querySelector('[data-role="setup-start-button"]').click();
    const result = await promise;
    assert.equal(result.sourceMode, 'custom');
  });

  await storage.openIndexedDb();
  assert.deepEqual(recordedOpenCalls, [{ name: 'custom-db', version: 7 }]);
});
