const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULTS,
  getStorageArea,
  cloneSettings,
  normalizeSettings,
  normalizeRejectedError,
  normalizeRejectedMessage,
  storageGet,
  storageSet,
  queryTabs,
  sendTabMessage,
  openTab,
} = require('../src/shell-extension/shared');

test('shell shared helpers merge and normalize settings safely', () => {
  assert.deepEqual(cloneSettings(DEFAULTS, null), DEFAULTS);
  assert.deepEqual(cloneSettings({ a: 1 }, { b: 2 }), { a: 1, b: 2 });
  assert.deepEqual(
    normalizeSettings({
      verifyUnsolved: true,
      cacheEnabled: false,
      forceRefresh: true,
      cacheTtlMs: '60000',
      navScope: 'all',
    }),
    {
      verifyUnsolved: true,
      cacheEnabled: false,
      forceRefresh: true,
      cacheTtlMs: 60000,
      navScope: 'all',
    }
  );
  assert.deepEqual(normalizeSettings({ cacheTtlMs: 'bad' }), DEFAULTS);
});

test('shell shared helpers support promise-based extension storage/tabs APIs', async () => {
  const api = {
    storage: {
      sync: {
        get(defaults) {
          return Promise.resolve({ ...defaults, verifyUnsolved: true });
        },
        set(values) {
          return Promise.resolve(values);
        },
      },
    },
    tabs: {
      query(queryInfo) {
        return Promise.resolve([{ id: 7, queryInfo }]);
      },
      sendMessage(tabId, message) {
        return Promise.resolve({ ok: true, tabId, type: message.type });
      },
    },
    runtime: {},
  };

  const settings = await new Promise((resolve) => {
    storageGet(DEFAULTS, resolve, api);
  });
  const storageResult = await new Promise((resolve) => {
    storageSet({ verifyUnsolved: true }, resolve, api);
  });
  const tabs = await new Promise((resolve) => {
    queryTabs({ active: true }, resolve, api);
  });
  const messageResult = await new Promise((resolve) => {
    sendTabMessage(7, { type: 'pbinfo-launch' }, resolve, api);
  });

  assert.equal(settings.verifyUnsolved, true);
  assert.equal(storageResult, null);
  assert.deepEqual(tabs, [{ id: 7, queryInfo: { active: true } }]);
  assert.deepEqual(messageResult, { ok: true, tabId: 7, type: 'pbinfo-launch' });
});

test('shell shared helpers cover fallback branches and tab creation', async () => {
  const createdTabs = [];
  const api = {
    storage: {
      local: {},
    },
    tabs: {
      create(payload) {
        createdTabs.push(payload);
      },
      query() {
        return Promise.reject(new Error('query failed'));
      },
      sendMessage() {
        return Promise.reject(new Error('send failed'));
      },
    },
    runtime: {},
  };

  const settings = await new Promise((resolve) => {
    storageGet(DEFAULTS, resolve, api);
  });
  const writeResult = await new Promise((resolve) => {
    storageSet({ verifyUnsolved: true }, resolve, api);
  });
  const tabs = await new Promise((resolve) => {
    queryTabs({ active: true }, resolve, api);
  });
  const messageResult = await new Promise((resolve) => {
    sendTabMessage(1, { type: 'x' }, resolve, api);
  });

  openTab('https://www.pbinfo.ro/', api);

  assert.deepEqual(settings, DEFAULTS);
  assert.equal(writeResult, null);
  assert.deepEqual(tabs, []);
  assert.deepEqual(messageResult, { ok: false, error: 'send failed' });
  assert.deepEqual(createdTabs, [{ url: 'https://www.pbinfo.ro/' }]);
  assert.equal(getStorageArea({ storage: { local: { ok: true } } }).ok, true);
  assert.equal(getStorageArea(null), null);
});

test('shell shared helpers degrade cleanly for callback-based APIs and runtime errors', async () => {
  const api = {
    storage: {
      local: {
        get(_defaults, callback) {
          callback({ verifyUnsolved: true });
        },
        set(_values, callback) {
          api.runtime.lastError = { message: 'set failed' };
          callback();
          api.runtime.lastError = null;
        },
      },
    },
    tabs: {
      query(_queryInfo, callback) {
        callback([{ id: 11 }]);
      },
      sendMessage(_tabId, _message, callback) {
        api.runtime.lastError = { message: 'send failed' };
        callback(null);
        api.runtime.lastError = null;
      },
    },
    runtime: {
      lastError: null,
    },
  };

  const settings = await new Promise((resolve) => {
    storageGet(DEFAULTS, resolve, api);
  });
  const storageResult = await new Promise((resolve) => {
    storageSet({ verifyUnsolved: true }, resolve, api);
  });
  const tabs = await new Promise((resolve) => {
    queryTabs({ currentWindow: true }, resolve, api);
  });
  const messageResult = await new Promise((resolve) => {
    sendTabMessage(11, { type: 'pbinfo-launch' }, resolve, api);
  });

  assert.equal(settings.verifyUnsolved, true);
  assert.match(storageResult.message, /set failed/);
  assert.deepEqual(tabs, [{ id: 11 }]);
  assert.deepEqual(messageResult, { ok: false, error: 'send failed' });
});

test('shell shared helpers cover unavailable, callback-success, and empty-response branches', async () => {
  const promiseRejectApi = {
    storage: {
      sync: {
        set() {
          return Promise.reject(new Error('storage.set failed'));
        },
      },
    },
    runtime: {},
  };
  const callbackApi = {
    storage: {
      local: {
        set(_values, callback) {
          callback();
        },
      },
    },
    tabs: {
      sendMessage(_tabId, _message, callback) {
        callback();
      },
    },
    runtime: {
      lastError: null,
    },
  };
  const unavailableApi = {
    runtime: {},
  };

  const promiseRejectResult = await new Promise((resolve) => {
    storageSet({ cacheEnabled: true }, resolve, promiseRejectApi);
  });
  const callbackSuccess = await new Promise((resolve) => {
    storageSet({ cacheEnabled: true }, resolve, callbackApi);
  });
  const unavailableTabs = await new Promise((resolve) => {
    queryTabs({ active: true }, resolve, unavailableApi);
  });
  const unavailableMessage = await new Promise((resolve) => {
    sendTabMessage(5, { type: 'pbinfo-launch' }, resolve, unavailableApi);
  });
  const callbackNoResponse = await new Promise((resolve) => {
    sendTabMessage(7, { type: 'pbinfo-launch' }, resolve, callbackApi);
  });

  assert.match(promiseRejectResult.message, /storage\.set failed/);
  assert.equal(callbackSuccess, null);
  assert.deepEqual(unavailableTabs, []);
  assert.deepEqual(unavailableMessage, { ok: false, error: 'tabs.sendMessage unavailable' });
  assert.deepEqual(callbackNoResponse, { ok: false, error: 'no response' });
});

test('shell shared helpers normalize promise rejection payloads without messages', async () => {
  const api = {
    storage: {
      sync: {
        set() {
          return Promise.reject(new Error('storage.set failed'));
        },
      },
    },
    tabs: {
      sendMessage() {
        return Promise.reject(new Error('sendMessage failed'));
      },
    },
    runtime: {},
  };

  const storageResult = await new Promise((resolve) => {
    storageSet({ verifyUnsolved: true }, resolve, api);
  });
  const messageResult = await new Promise((resolve) => {
    sendTabMessage(1, { type: 'pbinfo-launch' }, resolve, api);
  });

  assert.match(storageResult.message, /storage\.set failed/);
  assert.deepEqual(messageResult, { ok: false, error: 'sendMessage failed' });
});

test('shell shared helpers normalize empty-message promise rejections to fallback errors', async () => {
  const storageError = new Error('storage set failed');
  storageError.message = '   ';
  const messageError = new Error('send message failed');
  messageError.message = '   ';
  const api = {
    storage: {
      sync: {
        set() {
          return Promise.reject(storageError);
        },
      },
    },
    tabs: {
      sendMessage() {
        return Promise.reject(messageError);
      },
    },
    runtime: {},
  };

  const storageResult = await new Promise((resolve) => {
    storageSet({ verifyUnsolved: true }, resolve, api);
  });
  const messageResult = await new Promise((resolve) => {
    sendTabMessage(2, { type: 'pbinfo-launch' }, resolve, api);
  });

  assert.match(storageResult.message, /storage\.set failed/);
  assert.deepEqual(messageResult, { ok: false, error: 'sendMessage failed' });
});

test('shell shared helpers normalize non-Error rejection payloads to fallback values', () => {
  const normalizedError = normalizeRejectedError({ reason: 'storage boom' }, 'storage.set failed');
  const normalizedMessage = normalizeRejectedMessage(
    { reason: 'message boom' },
    'sendMessage failed'
  );

  assert.equal(normalizedError.message, 'storage.set failed');
  assert.equal(normalizedMessage, 'sendMessage failed');
});

test('shell shared helpers openTab falls back safely when tabs API is unavailable', () => {
  const previousOpen = globalThis.open;
  const createdTabs = [];
  const openedWindows = [];
  const apiWithTabs = {
    tabs: {
      create(payload) {
        createdTabs.push(payload);
      },
    },
  };
  const apiWithoutTabs = {
    tabs: {},
  };

  globalThis.open = function (url, target, features) {
    openedWindows.push({ url, target, features });
    return null;
  };

  try {
    assert.equal(
      openTab('https://www.pbinfo.ro/problema/1', apiWithTabs, { openerTabId: 11 }),
      true
    );
    assert.equal(openTab('https://www.pbinfo.ro/problema/2', apiWithoutTabs), true);
    assert.equal(openTab(null, apiWithTabs), false);
    assert.equal(openTab('   ', apiWithTabs), false);

    assert.deepEqual(createdTabs, [
      {
        url: 'https://www.pbinfo.ro/problema/1',
        openerTabId: 11,
      },
    ]);
    assert.deepEqual(openedWindows, [
      {
        url: 'https://www.pbinfo.ro/problema/2',
        target: '_blank',
        features: 'noopener,noreferrer',
      },
    ]);
  } finally {
    if (previousOpen === undefined) {
      delete globalThis.open;
    } else {
      globalThis.open = previousOpen;
    }
  }
});
