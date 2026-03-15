const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  cloneSettings,
  getApi,
  storageGet,
  queryTabs,
  sendTabMessage,
} = require('../src/shell-extension/shared');

test('shell shared cleanup: getApi falls back to chrome when browser is absent', () => {
  const previousBrowser = globalThis.browser;
  const previousChrome = globalThis.chrome;

  delete globalThis.browser;
  globalThis.chrome = { runtime: { id: 'test-chrome' } };
  try {
    assert.deepEqual(getApi(), { runtime: { id: 'test-chrome' } });
  } finally {
    if (previousBrowser === undefined) {
      delete globalThis.browser;
    } else {
      globalThis.browser = previousBrowser;
    }
    if (previousChrome === undefined) {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = previousChrome;
    }
  }
});

test('shell shared cleanup: cloneSettings ignores non-object inputs explicitly', () => {
  assert.deepEqual(cloneSettings('bad-defaults', { verifyUnsolved: true }), {
    verifyUnsolved: true,
  });
  assert.deepEqual(cloneSettings({ cacheEnabled: true }, 'bad-values'), {
    cacheEnabled: true,
  });
});

test('shell shared cleanup: promise tab helpers normalize empty responses and non-array results', async () => {
  const api = {
    tabs: {
      query() {
        return Promise.resolve('not-an-array');
      },
      sendMessage() {
        return Promise.resolve(undefined);
      },
    },
    runtime: {},
  };

  const tabs = await new Promise((resolve) => {
    queryTabs({ active: true }, resolve, api);
  });
  const response = await new Promise((resolve) => {
    sendTabMessage(9, { type: 'pbinfo-launch' }, resolve, api);
  });

  assert.deepEqual(tabs, []);
  assert.deepEqual(response, { ok: false, error: 'no response' });
});

test('shell shared cleanup: callback storage and tab queries honor runtime.lastError fallbacks', async () => {
  const api = {
    storage: {
      local: {
        get(_defaults, callback) {
          api.runtime.lastError = { message: 'get failed' };
          callback({ verifyUnsolved: true });
          api.runtime.lastError = null;
        },
      },
    },
    tabs: {
      query(_query, callback) {
        api.runtime.lastError = { message: 'query failed' };
        callback([{ id: 1 }]);
        api.runtime.lastError = null;
      },
    },
    runtime: {
      lastError: null,
    },
  };

  const settings = await new Promise((resolve) => {
    storageGet({ cacheEnabled: true }, resolve, api);
  });
  const tabs = await new Promise((resolve) => {
    queryTabs({ active: true }, resolve, api);
  });

  assert.deepEqual(settings, { cacheEnabled: true });
  assert.deepEqual(tabs, []);
});

test('shell shared cleanup: content script guards stale script nodes and uses shared openTab bridge', () => {
  const rootDir = path.resolve(__dirname, '..');
  const source = fs.readFileSync(
    path.join(rootDir, 'src/shell-extension/content/content.js'),
    'utf8'
  );

  assert.match(source, /existingTag\s*=\s*existing\.tagName\?\.\s*toLowerCase\(\)/);
  assert.match(source, /hasExpectedTag\s*=\s*existingTag\s*===\s*'script'/);
  assert.match(source, /existing\.remove\(\)/);
  assert.match(source, /\bopenTab\(/);
  assert.doesNotMatch(source, /getApi\(\)\.tabs\.create/);
});

test('shell shared cleanup: options parser guards cache TTL against NaN before clamping', () => {
  const rootDir = path.resolve(__dirname, '..');
  const source = fs.readFileSync(
    path.join(rootDir, 'src/shell-extension/options/options.js'),
    'utf8'
  );

  assert.match(source, /Number\.isFinite\(/);
  assert.match(source, /cacheTtlMinutes\s*=\s*Math\.max\(1,\s*cacheTtlMinutes\)/);
});
