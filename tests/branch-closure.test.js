const test = require('node:test');
const assert = require('node:assert/strict');

const { parseHTML } = require('linkedom');

const {
  showSetupWizard,
  createIndexedDbStorage,
  makeStateKeys,
  createOutcomeLedger,
  summarizeOutcomeLedger,
  listRetryableOutcomeKeys,
  isLikelyPbinfoNotFoundHtml,
  isLikelyPbinfoBlockedHtml,
  normalizeListUrl,
  buildPageUrl,
  computeBackoffWithJitter,
  nextAdaptiveThrottleState,
  parseSupportedTag,
  createAllowedElement,
  sanitizeHref,
  appendSimpleMarkup,
} = require('../src/core');
const { extractColorFromStyle } = require('../src/core/log-markup');
const {
  getApi,
  cloneSettings,
  queryTabs,
  sendTabMessage,
} = require('../src/shell-extension/shared');

function createConfig(overrides = {}) {
  return {
    startPage: 0,
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

function createLocalStorage() {
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

function setSelectOptions(select, options) {
  select.replaceChildren();
  for (const option of options) {
    const element = select.ownerDocument.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    select.appendChild(element);
  }
}

function notifyRequestSuccess(request) {
  queueMicrotask(function () {
    if (typeof request.onsuccess === 'function') {
      request.onsuccess();
    }
  });
}

function notifyOpenRequestSuccess(request) {
  queueMicrotask(function () {
    if (typeof request.onupgradeneeded === 'function') {
      request.onupgradeneeded();
    }
    if (typeof request.onsuccess === 'function') {
      request.onsuccess();
    }
  });
}

function createDb() {
  return {
    objectStoreNames: {
      contains() {
        return true;
      },
    },
    transaction() {
      return {
        oncomplete: null,
        onerror: null,
        objectStore() {
          return {
            get() {
              const request = { onsuccess: null, onerror: null, result: null };
              notifyRequestSuccess(request);
              return request;
            },
            put() {},
            delete() {},
            clear() {},
          };
        },
      };
    },
  };
}

async function withGlobalValue(name, value, callback) {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, name);

  if (value === undefined) {
    delete globalThis[name];
  } else {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  try {
    return await callback();
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, name, previousDescriptor);
    } else {
      delete globalThis[name];
    }
  }
}

test('branch closure: setup wizard defaults, toggles, and current-source submission cover remaining UI branches', async () => {
  const { document, window } = parseHTML('<html><body></body></html>');
  const promise = showSetupWizard({
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    config: createConfig(),
    defaults: {
      scanMode: 'id-range',
      sourceMode: 'custom',
      pageLink: 'https://www.pbinfo.ro/?pagina=probleme-lista&start=20',
      idRange: '31-45',
      startPage: 0,
      speedPreset: 'safe',
      verifyUnsolved: true,
      forceRefresh: false,
      resumeSavedState: false,
    },
    overlayEnabled: true,
    localStorageApi: createLocalStorage(),
    documentRef: document,
    locationRef: { origin: 'https://www.pbinfo.ro' },
    setSelectOptions,
  });
  const modeSelect = document.querySelector('[data-role="setup-mode"]');
  const sourceSelect = document.querySelector('[data-role="setup-source"]');
  const urlInput = document.querySelector('[data-role="setup-url"]');
  const rangeInput = document.querySelector('[data-role="setup-range"]');
  const startInput = document.querySelector('[data-role="setup-start"]');
  const summary = document.querySelector('[data-role="setup-summary"]');

  assert.notEqual(modeSelect, null);
  assert.notEqual(sourceSelect, null);
  assert.equal(urlInput.value, 'https://www.pbinfo.ro/?pagina=probleme-lista&start=20');
  assert.equal(rangeInput.value, '31-45');
  assert.equal(startInput.value, '0');
  assert.equal(urlInput.parentElement.style.display, 'none');
  assert.equal(rangeInput.parentElement.style.display, 'none');
  assert.match(summary.textContent, /pagina curentă/);
  document.querySelector('[data-role="setup-cancel"]').dispatchEvent(new window.Event('click'));
  assert.equal(await promise, null);
  assert.equal(document.querySelector('[data-role="setup-cancel"]'), null);
});

test('branch closure: storage falls back through globals and scalar hydration keys', async () => {
  await withGlobalValue(
    'indexedDB',
    {
      open() {
        const request = {
          result: createDb(),
          error: null,
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
        };
        notifyOpenRequestSuccess(request);
        return request;
      },
    },
    async function () {
      await withGlobalValue('localStorage', createLocalStorage(), async function () {
        const storage = createIndexedDbStorage();
        assert.match(makeStateKeys(null).full, /^pbinfo-get-unsolved:state:v2:/);

        await storage.initIndexedDbState('   ');
        assert.equal(storage.state.enabled, true);
        assert.deepEqual(storage.storageGetJson('missing'), null);
      });
    }
  );
});

test('branch closure: outcome, network, and shared fallbacks hit the remaining status and global branches', async () => {
  const ledger = createOutcomeLedger([
    { targetType: 'page', targetKey: 1, status: 'timeout' },
    { targetType: 'page', targetKey: 2, status: 'parse_fail' },
    { targetType: 'page', targetKey: 3, status: 'success' },
  ]);

  assert.equal(summarizeOutcomeLedger(null).avgDurationMs, 0);
  assert.equal(summarizeOutcomeLedger(ledger).timeout, 1);
  assert.equal(summarizeOutcomeLedger(ledger).parseFail, 1);
  assert.deepEqual(listRetryableOutcomeKeys(null), []);

  assert.equal(isLikelyPbinfoNotFoundHtml(), false);
  assert.equal(isLikelyPbinfoBlockedHtml(), false);
  assert.equal(
    normalizeListUrl('https://www.pbinfo.ro/?pagina=probleme-lista&start=30', '', '   '),
    'https://www.pbinfo.ro/?pagina=probleme-lista'
  );
  assert.equal(
    buildPageUrl('https://www.pbinfo.ro/?pagina=probleme-lista', { pageIndex: 3, param: '   ' }),
    'https://www.pbinfo.ro/?pagina=probleme-lista&start=20'
  );
  await withGlobalValue('crypto', undefined, async function () {
    assert.equal(computeBackoffWithJitter(undefined, undefined), 0);
  });
  assert.deepEqual(nextAdaptiveThrottleState(null, 'success', null), {
    enabled: true,
    baseDelayMs: 0,
    baseConcurrency: 1,
    delayMs: 0,
    concurrency: 1,
    cleanStreak: 1,
  });

  await withGlobalValue('browser', undefined, async function () {
    await withGlobalValue(
      'chrome',
      {
        tabs: {
          query() {
            return Promise.resolve('bad');
          },
          sendMessage() {
            return Promise.resolve(undefined);
          },
        },
      },
      async function () {
        assert.equal(getApi(), globalThis.chrome);
        assert.deepEqual(cloneSettings(null, { cacheEnabled: false }), { cacheEnabled: false });

        const tabs = await new Promise((resolve) => {
          queryTabs({}, resolve, getApi());
        });
        const response = await new Promise((resolve) => {
          sendTabMessage(1, { type: 'probe' }, resolve, getApi());
        });

        assert.deepEqual(tabs, []);
        assert.deepEqual(response, { ok: false, error: 'no response' });
      }
    );
  });
});

test('branch closure: log markup handles null tags, fallback URLs, and matched close tags', () => {
  const { document } = parseHTML('<html><body><div id="target"></div></body></html>');
  const target = document.getElementById('target');

  assert.equal(extractColorFromStyle(), '');
  assert.equal(parseSupportedTag(null), null);
  assert.deepEqual(parseSupportedTag('<span style="color:red"   >'), {
    kind: 'open',
    tagName: 'span',
    attrs: { style: 'color:red' },
  });
  assert.equal(createAllowedElement(null, {}, document, 'https://www.pbinfo.ro/'), null);
  assert.equal(sanitizeHref('/problema/1', ''), 'https://www.pbinfo.ro/problema/1');

  appendSimpleMarkup(target, '<b><i>x</i></b>', {});
  assert.equal(target.querySelector('b i').textContent, 'x');
});
