const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readSecureRandomToken,
  hasStorageMethod: hasRuntimeStorageMethod,
  readLocalStorageValue: readRuntimeStorageValue,
  readLocalStorageJson,
  removeLocalStorageKey,
  writeLocalStorageJson,
  ensureObjectStore,
  createIndexedDbStorage,
} = require('../src/core/runtime-storage');
const {
  hasStorageMethod: hasRuntimeSetupMethod,
  readLocalStorageValue: readRuntimeSetupValue,
  writeLocalStorageValue,
  resolveThemeTarget,
  parsePositiveInteger,
  normalizeScanMode,
  parseIdRangeInput,
  loadThemePreference,
  applyThemePreference,
} = require('../src/core/runtime-setup');
const {
  getApi,
  isObjectRecord,
  hasThen,
  onResolved,
  onRejected,
  storageGet,
  storageSet,
  queryTabs,
  sendTabMessage,
  openTab,
} = require('../src/shell-extension/shared');
const {
  isAsciiLettersOnly,
  isHexColor,
  extractColorFromStyle,
  skipWhitespace,
  readAttributeName,
  readQuotedAttributeValue,
  readAttributeEntry,
  findTagBounds,
  parseSupportedTag,
} = require('../src/core/log-markup');

function notifyTransactionError(transaction) {
  queueMicrotask(function () {
    if (typeof transaction.onerror === 'function') {
      transaction.onerror();
    }
  });
}

test('internal helper coverage: runtime-storage local helpers and store creation branches', async () => {
  const removeCalls = [];
  const localStorageApi = {
    getItem(key) {
      if (key === 'throws') {
        throw new Error('blocked');
      }
      if (key === 'json') {
        return '{"ok":true}';
      }
      return 'plain';
    },
    removeItem(key) {
      removeCalls.push(key);
    },
  };
  const db = {
    objectStoreNames: {
      contains(name) {
        return name === 'existing';
      },
    },
    createObjectStore(name) {
      removeCalls.push('create:' + name);
    },
  };
  const failingStorage = {};
  const quotaStorage = {
    setItem() {
      const error = new Error('quota');
      error.code = 1014;
      throw error;
    },
  };
  const badIndexedDb = {
    open() {
      const request = { error: new Error('open failed'), onerror: null };
      queueMicrotask(function () {
        if (typeof request.onerror === 'function') {
          request.onerror();
        }
      });
      return request;
    },
  };
  const storage = createIndexedDbStorage({
    indexedDBApi: badIndexedDb,
    localStorageApi,
  });

  assert.equal(readSecureRandomToken(null), '00000000000000');
  assert.equal(hasRuntimeStorageMethod(localStorageApi, 'getItem'), true);
  assert.equal(hasRuntimeStorageMethod(localStorageApi, 'missing'), false);
  assert.equal(readRuntimeStorageValue(localStorageApi, 'throws'), null);
  assert.deepEqual(readLocalStorageJson(localStorageApi, 'json'), { ok: true });
  removeLocalStorageKey({}, 'missing');
  removeLocalStorageKey(localStorageApi, 'remove-me');
  assert.deepEqual(removeCalls, ['remove-me']);
  assert.deepEqual(writeLocalStorageJson(failingStorage, 'key', { ok: true }), {
    ok: false,
    errorType: 'unknown',
  });
  assert.deepEqual(writeLocalStorageJson(quotaStorage, 'key', { ok: true }), {
    ok: false,
    errorType: 'quota',
  });
  ensureObjectStore(db, 'new-store');
  ensureObjectStore(db, 'existing');
  assert.deepEqual(removeCalls, ['remove-me', 'create:new-store']);

  await storage.initIndexedDbState('missing');
  assert.equal(storage.state.enabled, false);
});

test('internal helper coverage: runtime-storage transaction error and enabled cache branches', async () => {
  const deleted = [];
  const localStorageApi = {
    removeItem(key) {
      deleted.push(key);
    },
  };
  const storage = createIndexedDbStorage({
    indexedDBApi: null,
    localStorageApi,
  });
  const transactionError = new Error('tx failed');
  const db = {
    transaction(_storeName, _mode) {
      const tx = {
        error: transactionError,
        oncomplete: null,
        onerror: null,
        objectStore() {
          return {
            get() {
              const request = { onsuccess: null, onerror: null, error: transactionError };
              queueMicrotask(function () {
                if (typeof request.onerror === 'function') {
                  request.onerror();
                }
              });
              return request;
            },
            put() {
              notifyTransactionError(tx);
            },
            delete() {
              notifyTransactionError(tx);
            },
            clear() {
              notifyTransactionError(tx);
            },
          };
        },
      };
      return tx;
    },
  };

  storage.state.enabled = true;
  storage.state.db = db;
  storage.storageCache.set('cached', { ok: true });
  storage.storageCache.set('bad', []);

  await assert.rejects(storage.idbRead('scanState', 'key'), /tx failed/);
  await assert.rejects(storage.idbWrite('scanState', 'key', { ok: true }), /tx failed/);
  await assert.rejects(storage.idbDelete('scanState', 'key'), /tx failed/);
  await assert.rejects(storage.idbClearStore('scanState'), /tx failed/);
  assert.equal(storage.storageHasValue(''), false);
  assert.equal(storage.storageHasValue('cached'), true);
  assert.deepEqual(storage.storageGetJson(['', 'cached']), { ok: true });
  assert.deepEqual(storage.storageSetJson('direct', { ok: true }), {
    ok: true,
    errorType: null,
  });
  storage.storageRemove(['', 'cached', 'direct']);
  assert.deepEqual(deleted, ['direct', 'cached', 'direct']);
});

test('internal helper coverage: runtime-setup low-level fallbacks and theme target resolution', () => {
  const fallbackTarget = {
    dataset: {},
  };
  const runtimeLessStorage = {};

  assert.equal(hasRuntimeSetupMethod(runtimeLessStorage, 'getItem'), false);
  assert.equal(readRuntimeSetupValue(runtimeLessStorage, 'missing'), null);
  writeLocalStorageValue(runtimeLessStorage, 'missing', 'value');
  assert.equal(normalizeScanMode('1'), 'list');
  assert.equal(resolveThemeTarget({}, null), null);
  assert.equal(parsePositiveInteger('0'), null);
  assert.equal(parseIdRangeInput('', ''), null);
  assert.equal(loadThemePreference(runtimeLessStorage), 'system');
  assert.equal(
    applyThemePreference('dark', {}, { fallbackTarget, localStorageApi: runtimeLessStorage }),
    'dark'
  );
  assert.equal(fallbackTarget.dataset.theme, 'dark');
});

test('internal helper coverage: shared extension helpers exercise direct fallback branches', async () => {
  const browserBefore = Object.getOwnPropertyDescriptor(globalThis, 'browser');
  const chromeBefore = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

  Object.defineProperty(globalThis, 'browser', { configurable: true, value: null });
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { sentinel: true } });
  try {
    assert.deepEqual(getApi(), { sentinel: true });
  } finally {
    if (browserBefore) {
      Object.defineProperty(globalThis, 'browser', browserBefore);
    } else {
      delete globalThis.browser;
    }
    if (chromeBefore) {
      Object.defineProperty(globalThis, 'chrome', chromeBefore);
    } else {
      delete globalThis.chrome;
    }
  }

  assert.equal(isObjectRecord([]), true);
  assert.equal(hasThen(Promise.resolve()), true);
  assert.equal(hasThen(null), false);

  let resolved = null;
  onResolved(function (value) {
    resolved = value;
  }, 'ok');
  assert.equal(resolved, 'ok');

  let rejected = null;
  onRejected(function (value) {
    rejected = value;
  }, 'fallback')();
  assert.equal(rejected, 'fallback');

  const callbackStorageApi = {
    storage: {
      local: {
        get(_defaults, callback) {
          callback({ verifyUnsolved: true });
        },
        set(_values, callback) {
          callback();
        },
      },
    },
    tabs: {
      query(_query, callback) {
        callback(null);
      },
      sendMessage(_tabId, _message, callback) {
        callback(null);
      },
    },
    runtime: {
      lastError: { message: 'callback failed' },
    },
  };
  const emptyApi = { runtime: {} };

  const settings = await new Promise((resolve) => storageGet({}, resolve, callbackStorageApi));
  const setResult = await new Promise((resolve) => storageSet({}, resolve, callbackStorageApi));
  const queried = await new Promise((resolve) => queryTabs({}, resolve, callbackStorageApi));
  const messaged = await new Promise((resolve) =>
    sendTabMessage(1, {}, resolve, callbackStorageApi)
  );

  assert.deepEqual(settings, {});
  assert.match(setResult.message, /callback failed/);
  assert.deepEqual(queried, []);
  assert.deepEqual(messaged, { ok: false, error: 'callback failed' });
  openTab('https://www.pbinfo.ro/', emptyApi);
});

test('internal helper coverage: log-markup helper edge cases stay explicit', () => {
  assert.equal(isAsciiLettersOnly('abc'), true);
  assert.equal(isAsciiLettersOnly('ab1'), false);
  assert.equal(isHexColor('blue'), false);
  assert.equal(extractColorFromStyle('background:red'), '');
  assert.equal(skipWhitespace('   x', 0), 3);
  assert.equal(readAttributeName('="?x"', 0), null);
  assert.equal(readQuotedAttributeValue('abc', 0), null);
  assert.equal(readAttributeEntry('href=test', 0), null);
  assert.equal(findTagBounds('plain text', 0), null);
  assert.equal(parseSupportedTag('plain'), null);
  assert.equal(parseSupportedTag('</1bad>'), null);
});
