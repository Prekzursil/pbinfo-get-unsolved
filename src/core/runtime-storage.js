const { normalizeSpace } = require('./text-utils');

const STORAGE_NAMESPACE = 'pbinfo-get-unsolved';
const STATE_STORAGE_VERSION = 2;
const LEGACY_STATE_STORAGE_VERSION = 1;
const EMPTY_STORAGE_OPTIONS = Object.freeze(Object.create(null));

function safeJsonParse(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isPlainRecord(value) {
  return value !== null && !Array.isArray(value) && Object(value) === value;
}

function fnv1a32(str) {
  const source = String(str || '');
  let hash = 0x811c9dc5;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.codePointAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function readSecureRandomToken(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const values = new Uint32Array(2);
    cryptoApi.getRandomValues(values);
    return Array.from(values, (value) => value.toString(36).padStart(7, '0')).join('');
  }

  return '00000000000000';
}

function createSnapshotId(now = Date.now(), cryptoApi = globalThis.crypto) {
  return `${now.toString(36)}-${readSecureRandomToken(cryptoApi).slice(0, 12)}`;
}

function makeStateKeys(pageLink, version = STATE_STORAGE_VERSION) {
  const hash = fnv1a32(pageLink);
  const keys = {};
  keys.full = `${STORAGE_NAMESPACE}:state:v${version}:${hash}`;
  keys.minimal = `${STORAGE_NAMESPACE}:state-min:v${version}:${hash}`;
  keys.index = `${STORAGE_NAMESPACE}:state-index:v${version}:${hash}`;
  keys.itemPrefix = `${STORAGE_NAMESPACE}:state-item:v${version}:${hash}:`;
  return keys;
}

function classifyStorageError(err) {
  const errorName = err?.name;
  const errorCode = err?.code;

  if (errorName === 'QuotaExceededError' || errorCode === 22 || errorCode === 1014) {
    return 'quota';
  }

  return 'unknown';
}

function getIndexedDbStoreForKey(key) {
  const normalizedKey = normalizeSpace(key);

  if (!normalizedKey) {
    return null;
  }

  if (normalizedKey.includes(':state-index:') || normalizedKey.includes(':state-item:')) {
    return 'snapshots';
  }

  return 'scanState';
}

function hasStorageMethod(storageApi, methodName) {
  return typeof storageApi?.[methodName] === 'function';
}

function readLocalStorageItemSafely(localStorageApi, key) {
  let value = null;
  try {
    value = localStorageApi.getItem(key);
  } catch {
    // Ignore storage read errors and fall back to the default null value.
  }
  return value;
}

function readLocalStorageValue(localStorageApi, key) {
  if (!hasStorageMethod(localStorageApi, 'getItem')) return null;
  return readLocalStorageItemSafely(localStorageApi, key);
}

function readLocalStorageJson(localStorageApi, key) {
  return safeJsonParse(readLocalStorageValue(localStorageApi, key));
}

function removeLocalStorageKey(localStorageApi, key) {
  if (!hasStorageMethod(localStorageApi, 'removeItem')) {
    return;
  }

  try {
    localStorageApi.removeItem(key);
  } catch {
    // Ignore storage removal errors and let the caller continue.
  }
}

function writeLocalStorageJson(localStorageApi, key, value) {
  if (!hasStorageMethod(localStorageApi, 'setItem')) {
    return { ok: false, errorType: 'unknown' };
  }

  try {
    localStorageApi.setItem(key, JSON.stringify(value));
    return { ok: true, errorType: null };
  } catch (error) {
    return { ok: false, errorType: classifyStorageError(error) };
  }
}

function ensureObjectStore(db, storeName) {
  if (!db.objectStoreNames.contains(storeName)) {
    db.createObjectStore(storeName);
  }
}

function openIndexedDbBackend({ indexedDbApi, backendPreference, databaseName, databaseVersion }) {
  return new Promise((resolve, reject) => {
    if (indexedDbApi?.open == null || backendPreference === 'localstorage') {
      resolve(null);
      return;
    }

    const request = indexedDbApi.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const db = request.result;

      ensureObjectStore(db, 'prefs');
      ensureObjectStore(db, 'scanState');
      ensureObjectStore(db, 'snapshots');
      ensureObjectStore(db, 'outcomes');
      ensureObjectStore(db, 'parsedCache');
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error);
    };
  });
}

function runIndexedDbRead(state, storeName, key) {
  return new Promise((resolve, reject) => {
    if (state.db == null) {
      resolve(null);
      return;
    }

    const transaction = state.db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => {
      resolve(request.result ?? null);
    };
    request.onerror = () => {
      reject(request.error);
    };
  });
}

function runIndexedDbMutation(state, storeName, performMutation) {
  return new Promise((resolve, reject) => {
    if (state.db == null) {
      resolve(false);
      return;
    }

    const transaction = state.db.transaction(storeName, 'readwrite');
    performMutation(transaction.objectStore(storeName));
    transaction.oncomplete = () => {
      resolve(true);
    };
    transaction.onerror = () => {
      reject(transaction.error);
    };
  });
}

function runIndexedDbWrite(state, storeName, key, value) {
  return runIndexedDbMutation(state, storeName, (store) => {
    store.put(value, key);
  });
}

function runIndexedDbDelete(state, storeName, key) {
  return runIndexedDbMutation(state, storeName, (store) => {
    store.delete(key);
  });
}

function runIndexedDbClearStore(state, storeName) {
  return runIndexedDbMutation(state, storeName, (store) => {
    store.clear();
  });
}

function normalizeStorageKeys(keys) {
  return Array.isArray(keys) ? keys : [keys];
}

async function hydrateStorageEntry({
  key,
  storeName,
  storageCache,
  localStorageApi,
  idbRead,
  idbWrite,
}) {
  let hydrated = null;
  try {
    hydrated = await idbRead(storeName, key);
  } catch {
    hydrated = null;
  }

  if (isPlainRecord(hydrated)) {
    storageCache.set(key, hydrated);
    return;
  }

  const legacy = readLocalStorageJson(localStorageApi, key);
  if (!isPlainRecord(legacy)) {
    return;
  }

  storageCache.set(key, legacy);
  idbWrite(storeName, key, legacy).catch(() => {});
}

function storageHasValueForKey({ key, storageCache, localStorageApi }) {
  if (!key) {
    return false;
  }

  if (storageCache.has(key)) {
    return true;
  }

  return readLocalStorageValue(localStorageApi, key) != null;
}

function storageGetJsonForKeys({ keys, storageCache, localStorageApi }) {
  for (const key of normalizeStorageKeys(keys)) {
    if (!key) {
      continue;
    }

    if (storageCache.has(key)) {
      const cached = storageCache.get(key);
      if (isPlainRecord(cached)) {
        return cached;
      }
    }

    const parsed = readLocalStorageJson(localStorageApi, key);
    if (isPlainRecord(parsed)) {
      return parsed;
    }
  }

  return null;
}

function storageSetJsonForKey({ key, value, state, storageCache, localStorageApi, idbWrite }) {
  if (!key) {
    const failureResult = {};
    failureResult.ok = false;
    failureResult.errorType = 'unknown';
    return failureResult;
  }

  if (state.enabled) {
    storageCache.set(key, value);
    const storeName = getIndexedDbStoreForKey(key);

    if (storeName) {
      idbWrite(storeName, key, value).catch(() => {});
    }

    removeLocalStorageKey(localStorageApi, key);
    const successResult = {};
    successResult.ok = true;
    successResult.errorType = null;
    return successResult;
  }

  return writeLocalStorageJson(localStorageApi, key, value);
}

function storageRemoveKeys({ keys, state, storageCache, localStorageApi, idbDelete }) {
  for (const key of normalizeStorageKeys(keys)) {
    if (!key) {
      continue;
    }

    storageCache.delete(key);

    if (state.enabled) {
      const storeName = getIndexedDbStoreForKey(key);
      if (storeName) {
        idbDelete(storeName, key).catch(() => {});
      }
    }

    removeLocalStorageKey(localStorageApi, key);
  }
}

function createIndexedDbOperations({
  backendPreference,
  indexedDbApi,
  databaseName,
  databaseVersion,
  state,
  storageCache,
  localStorageApi,
}) {
  function openIndexedDb() {
    return openIndexedDbBackend({
      indexedDbApi,
      backendPreference,
      databaseName,
      databaseVersion,
    });
  }

  function idbRead(storeName, key) {
    return runIndexedDbRead(state, storeName, key);
  }

  function idbWrite(storeName, key, value) {
    return runIndexedDbWrite(state, storeName, key, value);
  }

  function idbDelete(storeName, key) {
    return runIndexedDbDelete(state, storeName, key);
  }

  function idbClearStore(storeName) {
    return runIndexedDbClearStore(state, storeName);
  }

  async function initIndexedDbState(keysToHydrate = []) {
    if (backendPreference === 'localstorage') {
      return;
    }

    try {
      state.db = await openIndexedDb();
      state.enabled = state.db != null;
    } catch {
      state.enabled = false;
      state.db = null;
      return;
    }

    if (!state.enabled) {
      return;
    }

    for (const key of normalizeStorageKeys(keysToHydrate)) {
      if (!key) {
        continue;
      }

      const storeName = getIndexedDbStoreForKey(key);
      if (!storeName) {
        continue;
      }

      await hydrateStorageEntry({
        key,
        storeName,
        storageCache,
        localStorageApi,
        idbRead,
        idbWrite,
      });
    }
  }

  return {
    openIndexedDb,
    idbRead,
    idbWrite,
    idbDelete,
    idbClearStore,
    initIndexedDbState,
  };
}

function resolveIndexedDbStorageOptions(options) {
  const source = options && typeof options === 'object' ? options : EMPTY_STORAGE_OPTIONS;
  return {
    backendPreference: source.backendPreference || 'auto',
    indexedDbApi: source.indexedDBApi ?? globalThis.indexedDB ?? null,
    localStorageApi: source.localStorageApi ?? globalThis.localStorage ?? null,
    databaseName: source.databaseName || STORAGE_NAMESPACE,
    databaseVersion: Number.isFinite(source.databaseVersion) ? source.databaseVersion : 1,
  };
}

function createIndexedDbStorageState() {
  return {
    enabled: false,
    db: null,
  };
}

function createIndexedDbStorageAccessors({ state, storageCache, localStorageApi, indexedDbOps }) {
  const storageHasValue = (key) => storageHasValueForKey({ key, storageCache, localStorageApi });
  const storageGetJson = (keys) => storageGetJsonForKeys({ keys, storageCache, localStorageApi });
  const storageSetJson = (key, value) =>
    storageSetJsonForKey({
      key,
      value,
      state,
      storageCache,
      localStorageApi,
      idbWrite: indexedDbOps.idbWrite,
    });
  const storageRemove = (keys) =>
    storageRemoveKeys({
      keys,
      state,
      storageCache,
      localStorageApi,
      idbDelete: indexedDbOps.idbDelete,
    });
  return { storageHasValue, storageGetJson, storageSetJson, storageRemove };
}

function createIndexedDbStorage(options = {}) {
  const resolvedOptions = resolveIndexedDbStorageOptions(options);
  const storageCache = new Map();
  const state = createIndexedDbStorageState();
  const indexedDbOps = createIndexedDbOperations({
    backendPreference: resolvedOptions.backendPreference,
    indexedDbApi: resolvedOptions.indexedDbApi,
    databaseName: resolvedOptions.databaseName,
    databaseVersion: resolvedOptions.databaseVersion,
    state,
    storageCache,
    localStorageApi: resolvedOptions.localStorageApi,
  });
  const accessors = createIndexedDbStorageAccessors({
    state,
    storageCache,
    localStorageApi: resolvedOptions.localStorageApi,
    indexedDbOps,
  });

  return {
    storageCache,
    state,
    ...indexedDbOps,
    ...accessors,
  };
}

module.exports = {
  STORAGE_NAMESPACE,
  STATE_STORAGE_VERSION,
  LEGACY_STATE_STORAGE_VERSION,
  safeJsonParse,
  isPlainRecord,
  fnv1a32,
  readSecureRandomToken,
  createSnapshotId,
  makeStateKeys,
  classifyStorageError,
  getIndexedDbStoreForKey,
  hasStorageMethod,
  readLocalStorageValue,
  readLocalStorageJson,
  removeLocalStorageKey,
  writeLocalStorageJson,
  ensureObjectStore,
  createIndexedDbStorage,
};
