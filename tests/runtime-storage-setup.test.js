const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STORAGE_NAMESPACE,
  STATE_STORAGE_VERSION,
  LEGACY_STATE_STORAGE_VERSION,
  safeJsonParse,
  readLocalStorageValue,
  createSnapshotId,
  makeStateKeys,
  classifyStorageError,
  getIndexedDbStoreForKey,
  createIndexedDbStorage,
} = require('../src/core/runtime-storage');
const {
  getSpeedPresetConfig,
  normalizeScanMode,
  styleWizardControl,
  loadThemePreference,
  applyThemePreference,
  loadSetupPreferences,
  saveSetupPreferences,
  parseIdRangeInput,
} = require('../src/core/runtime-setup');

function createFakeLocalStorage() {
  const store = new Map();

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

function notifyRequestSuccess(request, result) {
  queueMicrotask(function () {
    request.result = result;
    if (typeof request.onsuccess === 'function') {
      request.onsuccess();
    }
  });
}

function notifyTransactionComplete(transaction) {
  queueMicrotask(function () {
    if (typeof transaction.oncomplete === 'function') {
      transaction.oncomplete();
    }
  });
}

function notifyRequestError(request) {
  queueMicrotask(function () {
    if (typeof request.onerror === 'function') {
      request.onerror();
    }
  });
}

function notifyOpenRequest(request) {
  queueMicrotask(function () {
    if (typeof request.onupgradeneeded === 'function') {
      request.onupgradeneeded();
    }
    if (typeof request.onsuccess === 'function') {
      request.onsuccess();
    }
  });
}

function createStoreApi(store, transaction) {
  return {
    get(key) {
      const request = { onsuccess: null, onerror: null, result: null, error: null };
      const result = store?.has(key) ? store.get(key) : undefined;
      notifyRequestSuccess(request, result);
      return request;
    },
    put(value, key) {
      if (store) {
        store.set(key, value);
      }
      notifyTransactionComplete(transaction);
    },
    delete(key) {
      if (store) {
        store.delete(key);
      }
      notifyTransactionComplete(transaction);
    },
    clear() {
      if (store) {
        store.clear();
      }
      notifyTransactionComplete(transaction);
    },
  };
}

function createFakeIndexedDb(initialStores = {}) {
  const stores = new Map(
    Object.entries(initialStores).map(function ([storeName, values]) {
      return [storeName, new Map(Object.entries(values))];
    })
  );
  const db = {
    objectStoreNames: {
      contains(storeName) {
        return stores.has(storeName);
      },
    },
    createObjectStore(storeName) {
      if (!stores.has(storeName)) {
        stores.set(storeName, new Map());
      }
      return stores.get(storeName);
    },
    transaction(storeName) {
      const store = stores.get(storeName);
      const transaction = {
        error: null,
        oncomplete: null,
        onerror: null,
        objectStore() {
          return createStoreApi(store, transaction);
        },
      };
      return transaction;
    },
  };

  return {
    stores,
    db,
    open() {
      const request = {
        result: db,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      notifyOpenRequest(request);
      return request;
    },
  };
}

test('runtime storage helpers: state keys, parsing, and quota classification stay stable', () => {
  assert.equal(safeJsonParse(''), null);
  assert.equal(safeJsonParse('{'), null);
  assert.deepEqual(safeJsonParse('{"ok":true}'), { ok: true });

  const stateKeys = makeStateKeys('https://www.pbinfo.ro/?pagina=probleme-lista');
  assert.match(
    stateKeys.full,
    new RegExp(`^${STORAGE_NAMESPACE}:state:v${STATE_STORAGE_VERSION}:`)
  );
  assert.match(
    stateKeys.minimal,
    new RegExp(`^${STORAGE_NAMESPACE}:state-min:v${STATE_STORAGE_VERSION}:`)
  );
  assert.match(
    stateKeys.index,
    new RegExp(`^${STORAGE_NAMESPACE}:state-index:v${STATE_STORAGE_VERSION}:`)
  );
  assert.equal(
    makeStateKeys('https://www.pbinfo.ro/', LEGACY_STATE_STORAGE_VERSION).full.includes(':v1:'),
    true
  );
  assert.equal(classifyStorageError({ name: 'QuotaExceededError' }), 'quota');
  assert.equal(classifyStorageError({ code: 22 }), 'quota');
  assert.equal(classifyStorageError(new Error('other')), 'unknown');
  assert.equal(getIndexedDbStoreForKey(stateKeys.index), 'snapshots');
  assert.equal(getIndexedDbStoreForKey(`${stateKeys.itemPrefix}abc`), 'snapshots');
  assert.equal(getIndexedDbStoreForKey(stateKeys.full), 'scanState');
  assert.equal(getIndexedDbStoreForKey(''), null);
});

test('runtime storage helpers: snapshot ids and localStorage fallback stay deterministic', () => {
  const localStorageApi = createFakeLocalStorage();
  const storage = createIndexedDbStorage({
    backendPreference: 'localstorage',
    localStorageApi,
    indexedDBApi: null,
  });
  const snapshotId = createSnapshotId(1234567890, {
    getRandomValues(values) {
      values[0] = 1;
      values[1] = 2;
      return values;
    },
  });

  assert.equal(snapshotId, 'kf12oi-000000100000');
  assert.deepEqual(storage.storageGetJson('missing'), null);

  const writeResult = storage.storageSetJson('pbinfo-key', { savedAt: 1 });
  assert.deepEqual(writeResult, { ok: true, errorType: null });
  assert.deepEqual(storage.storageGetJson('pbinfo-key'), { savedAt: 1 });
  assert.equal(storage.storageHasValue('pbinfo-key'), true);

  storage.storageRemove('pbinfo-key');
  assert.equal(storage.storageHasValue('pbinfo-key'), false);
  assert.equal(storage.storageGetJson('pbinfo-key'), null);
});

test('runtime storage helpers: indexedDB adapter hydrates, reads, writes, and clears stores', async () => {
  const localStorageApi = createFakeLocalStorage();
  localStorageApi.setItem('legacy-key', JSON.stringify({ savedAt: 2 }));
  const indexedDbApi = createFakeIndexedDb({
    scanState: {
      'scan-key': { savedAt: 1 },
    },
    snapshots: {},
    prefs: {},
    outcomes: {},
    parsedCache: {},
  });
  const storage = createIndexedDbStorage({
    indexedDBApi: indexedDbApi,
    localStorageApi,
  });

  await storage.initIndexedDbState(['scan-key', 'legacy-key', '']);

  assert.equal(storage.state.enabled, true);
  assert.deepEqual(storage.storageGetJson('scan-key'), { savedAt: 1 });
  assert.deepEqual(storage.storageGetJson('legacy-key'), { savedAt: 2 });
  assert.equal(indexedDbApi.stores.get('scanState').has('legacy-key'), true);
  assert.deepEqual(await storage.idbRead('scanState', 'scan-key'), { savedAt: 1 });
  assert.equal(await storage.idbWrite('scanState', 'written-key', { savedAt: 3 }), true);
  assert.deepEqual(await storage.idbRead('scanState', 'written-key'), { savedAt: 3 });
  assert.equal(await storage.idbDelete('scanState', 'written-key'), true);
  assert.equal(await storage.idbRead('scanState', 'written-key'), null);
  assert.equal(await storage.idbClearStore('scanState'), true);
  assert.equal(await storage.idbRead('scanState', 'scan-key'), null);
});

test('runtime storage helpers: error and no-backend branches stay explicit', async () => {
  const localStorageApi = {
    getItem() {
      throw new Error('get failed');
    },
    setItem() {
      const error = new Error('quota');
      error.name = 'QuotaExceededError';
      throw error;
    },
    removeItem() {
      throw new Error('remove failed');
    },
  };
  const storage = createIndexedDbStorage({
    backendPreference: 'localstorage',
    localStorageApi,
    indexedDBApi: null,
  });

  await storage.initIndexedDbState('missing-key');

  assert.equal(storage.state.enabled, false);
  assert.equal(storage.storageHasValue('missing-key'), false);
  assert.equal(storage.storageGetJson(['missing-key', 'other-key']), null);
  assert.deepEqual(storage.storageSetJson('', { nope: true }), {
    ok: false,
    errorType: 'unknown',
  });
  assert.deepEqual(storage.storageSetJson('quota-key', { nope: true }), {
    ok: false,
    errorType: 'quota',
  });
  storage.storageRemove(['missing-key', 'other-key']);
  assert.equal(await storage.idbRead('scanState', 'missing-key'), null);
  assert.equal(await storage.idbWrite('scanState', 'missing-key', { nope: true }), false);
  assert.equal(await storage.idbDelete('scanState', 'missing-key'), false);
  assert.equal(await storage.idbClearStore('scanState'), false);
});

test('runtime storage helpers: cover no-op indexeddb hydration and legacy fallthrough paths', async () => {
  const noMethodStorage = createIndexedDbStorage({
    indexedDBApi: {},
    localStorageApi: {},
  });
  const localStorageApi = createFakeLocalStorage();
  const readErrorIndexedDb = {
    open() {
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
                  const request = { onsuccess: null, onerror: null, error: new Error('boom') };
                  notifyRequestError(request);
                  return request;
                },
              };
            },
          };
        },
      };
      const request = {
        result: db,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      notifyOpenRequest(request);
      return request;
    },
  };
  const readErrorStorage = createIndexedDbStorage({
    indexedDBApi: readErrorIndexedDb,
    localStorageApi,
  });

  localStorageApi.setItem('bad-legacy', '"not-an-object"');

  assert.equal(readLocalStorageValue({}, 'missing'), null);
  assert.equal(await noMethodStorage.openIndexedDb(), null);
  await noMethodStorage.initIndexedDbState(['   ']);
  assert.equal(noMethodStorage.state.enabled, false);

  await readErrorStorage.initIndexedDbState(['   ', 'bad-legacy']);

  assert.equal(readErrorStorage.state.enabled, true);
  assert.equal(readErrorStorage.storageGetJson('bad-legacy'), null);
});

test('runtime setup helpers: presets, scan mode normalization, and id range parsing stay consistent', () => {
  assert.deepEqual(getSpeedPresetConfig('safe'), {
    preset: 'safe',
    concurrency: 1,
    delayMs: 250,
  });
  assert.deepEqual(getSpeedPresetConfig('FAST'), {
    preset: 'fast',
    concurrency: 2,
    delayMs: 0,
  });
  assert.deepEqual(getSpeedPresetConfig('other'), {
    preset: 'balanced',
    concurrency: 1,
    delayMs: 100,
  });
  assert.equal(normalizeScanMode('list'), 'list');
  assert.equal(normalizeScanMode('ID RANGE'), 'id-range');
  assert.equal(normalizeScanMode('2'), 'id-range');
  assert.equal(normalizeScanMode('weird'), null);
  assert.deepEqual(parseIdRangeInput('10-20', ''), { startId: 10, endId: 20 });
  assert.deepEqual(parseIdRangeInput('', '15'), { startId: 1, endId: 15 });
  assert.deepEqual(parseIdRangeInput('  7 - 8 ', ''), { startId: 7, endId: 8 });
  assert.equal(parseIdRangeInput('abc', ''), null);
});

test('runtime setup helpers: theme and setup preferences persist through injected storage', () => {
  const localStorageApi = createFakeLocalStorage();
  const target = {
    dataset: {},
    setAttribute(name, value) {
      this.attributes = this.attributes || {};
      this.attributes[name] = value;
    },
    removeAttribute(name) {
      this.attributes = this.attributes || {};
      delete this.attributes[name];
    },
  };

  assert.equal(loadThemePreference(localStorageApi), 'system');
  assert.equal(
    applyThemePreference('dark', target, { localStorageApi, fallbackTarget: null }),
    'dark'
  );
  assert.equal(target.dataset.theme, 'dark');
  assert.equal(loadThemePreference(localStorageApi), 'dark');

  assert.equal(
    applyThemePreference('invalid', target, { localStorageApi, fallbackTarget: null }),
    'system'
  );
  assert.equal(target.dataset.theme, undefined);
  assert.equal(loadThemePreference(localStorageApi), 'system');

  assert.deepEqual(loadSetupPreferences(localStorageApi), {});
  saveSetupPreferences({ verifyUnsolved: true }, localStorageApi);
  assert.deepEqual(loadSetupPreferences(localStorageApi), { verifyUnsolved: true });
});

test('runtime setup helpers: styling and invalid storage payloads normalize safely', () => {
  const localStorageApi = {
    getItem() {
      return '[1,2,3]';
    },
    setItem() {
      throw new Error('write blocked');
    },
  };
  const control = { style: {} };
  const fallbackTarget = {
    dataset: {},
  };

  assert.equal(styleWizardControl(control), control);
  assert.equal(control.style.border, '1px solid #cbd5e1');
  assert.deepEqual(loadSetupPreferences(localStorageApi), {});
  saveSetupPreferences(['bad'], localStorageApi);
  assert.equal(applyThemePreference('light', {}, { localStorageApi, fallbackTarget }), 'light');
  assert.equal(fallbackTarget.dataset.theme, 'light');
});
