const test = require('node:test');
const assert = require('node:assert/strict');

const { parseHTML } = require('linkedom');

const {
  makeStateKeys,
  createIndexedDbStorage,
  resolveSetupWizardResult,
  showSetupWizard,
  isLikelyPbinfoNotFoundHtml,
  isLikelyPbinfoBlockedHtml,
  normalizeListUrl,
  buildPageUrl,
  computeBackoffWithJitter,
  nextAdaptiveThrottleState,
  detectPbinfoUserNamespace,
  createOutcomeLedger,
  summarizeOutcomeLedger,
  listRetryableOutcomeEntries,
  parseSupportedTag,
  appendSimpleMarkup,
  sanitizeHref,
} = require('../src/core');
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

function createWizardDefaults() {
  return {
    scanMode: 'id-range',
    sourceMode: 'custom',
    pageLink: 'https://www.pbinfo.ro/?pagina=probleme-lista&tag=123',
    idRange: '40-50',
    startPage: 1,
    speedPreset: 'safe',
    verifyUnsolved: true,
    forceRefresh: false,
    resumeSavedState: false,
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

test('final branch push: extension globals and storage fallback branches', async () => {
  const originalChrome = globalThis.chrome;
  const originalBrowser = globalThis.browser;
  const originalLocalStorage = globalThis.localStorage;
  globalThis.browser = undefined;
  globalThis.chrome = {
    storage: { local: {} },
    tabs: {},
  };
  globalThis.localStorage = createLocalStorage({
    legacy: JSON.stringify({ savedAt: 7 }),
  });

  try {
    assert.equal(getApi(), globalThis.chrome);
    assert.deepEqual(cloneSettings(null, { ok: true }), { ok: true });
    assert.match(makeStateKeys(null).full, /^pbinfo-get-unsolved:state:v2:/);

    const storage = createIndexedDbStorage({
      indexedDBApi: null,
    });
    await storage.initIndexedDbState('legacy');
    assert.deepEqual(storage.storageGetJson('legacy'), { savedAt: 7 });
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.browser = originalBrowser;
    if (originalLocalStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = originalLocalStorage;
    }
  }
});

test('final branch push: tabs messaging fallback branches stay explicit', async () => {
  const tabs = await new Promise((resolve) => {
    queryTabs({}, resolve, {
      tabs: {
        query() {
          return Promise.resolve('not-an-array');
        },
      },
    });
  });
  const response = await new Promise((resolve) => {
    sendTabMessage(1, { type: 'ping' }, resolve, {
      tabs: {
        sendMessage() {
          return Promise.resolve(undefined);
        },
      },
    });
  });

  assert.deepEqual(tabs, []);
  assert.deepEqual(response, { ok: false, error: 'no response' });
});

test('final branch push: storage-setup defaults stay explicit', () => {
  const config = createConfig();
  const resolved = resolveSetupWizardResult({
    mode: 'list',
    sourceMode: 'current',
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    urlInputValue: 'https://ignored.example/',
    rangeInputValue: '',
    startInputValue: '',
    speedPresetValue: 'safe',
    concurrencyInputValue: 'not-a-number',
    delayInputValue: 'not-a-number',
    verifyUnsolved: false,
    forceRefresh: false,
    resumeSavedState: false,
    config,
    locationRef: { origin: 'https://www.pbinfo.ro' },
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.result.startPage, 1);
  assert.equal(resolved.result.pageLink, 'https://www.pbinfo.ro/?pagina=probleme-lista');
  assert.equal(resolved.result.concurrency, 1);
  assert.equal(resolved.result.delayMs, 250);
});

test('final branch push: setup wizard view branches stay explicit', async () => {
  const config = createConfig();
  const { document, window } = parseHTML('<html><body></body></html>');
  const promise = showSetupWizard({
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    config,
    defaults: createWizardDefaults(),
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
  const summary = document.querySelector('[data-role="setup-summary"]');

  modeSelect.options[1].selected = true;
  modeSelect.dispatchEvent(new window.Event('change'));
  sourceSelect.options[1].selected = true;
  sourceSelect.dispatchEvent(new window.Event('change'));

  assert.equal(urlInput.value, 'https://www.pbinfo.ro/?pagina=probleme-lista&tag=123');
  assert.equal(rangeInput.value, '40-50');
  assert.match(summary.textContent, /intervalul 40-50/i);

  modeSelect.options[0].selected = true;
  modeSelect.dispatchEvent(new window.Event('change'));
  sourceSelect.options[0].selected = true;
  sourceSelect.dispatchEvent(new window.Event('change'));

  assert.equal(urlInput.parentElement.style.display, 'none');
  assert.equal(rangeInput.parentElement.style.display, 'none');
  assert.match(summary.textContent, /pagina curentă/i);

  document.querySelector('[data-role="setup-cancel"]').click();
  assert.equal(await promise, null);
});

test('final branch push: network helper normalization fallbacks', () => {
  const originalCrypto = globalThis.crypto;
  delete globalThis.crypto;

  try {
    assert.equal(isLikelyPbinfoNotFoundHtml(), false);
    assert.equal(isLikelyPbinfoBlockedHtml(), false);
    assert.equal(
      normalizeListUrl('https://www.pbinfo.ro/?pagina=probleme-lista&start=30', '', '   '),
      'https://www.pbinfo.ro/?pagina=probleme-lista'
    );
    assert.equal(
      buildPageUrl('https://www.pbinfo.ro/?pagina=probleme-lista', {
        pageIndex: 2,
        param: '   ',
        pageSize: Number.NaN,
        mode: 'unexpected',
        pageBase: Number.NaN,
      }),
      'https://www.pbinfo.ro/?pagina=probleme-lista&start=10'
    );
    assert.equal(computeBackoffWithJitter(undefined, undefined), 0);
    assert.deepEqual(nextAdaptiveThrottleState(null, 'success', null), {
      enabled: true,
      baseDelayMs: 0,
      baseConcurrency: 1,
      delayMs: 0,
      concurrency: 1,
      cleanStreak: 1,
    });
  } finally {
    if (originalCrypto === undefined) {
      delete globalThis.crypto;
    } else {
      globalThis.crypto = originalCrypto;
    }
  }
});

test('final branch push: outcome helper normalization fallbacks', () => {
  const ledger = createOutcomeLedger([
    { targetType: 'page', targetKey: 1, status: 'success' },
    { targetType: 'page', targetKey: 2, status: 'blocked' },
    { targetType: 'page', targetKey: 3, status: 'timeout' },
    { targetType: 'page', targetKey: 4, status: 'parse_fail' },
    { targetType: 'page', targetKey: 5, status: 'http_error' },
    { targetType: 'page', targetKey: 6, status: 'skipped' },
  ]);
  const summary = summarizeOutcomeLedger(ledger);

  assert.deepEqual(summarizeOutcomeLedger(null), {
    total: 0,
    success: 0,
    blocked: 0,
    rateLimited: 0,
    timeout: 0,
    parseFail: 0,
    httpError: 0,
    skipped: 0,
    unknown: 0,
    unknowns: 0,
    retryCount: 0,
    avgDurationMs: 0,
  });
  assert.equal(summary.success, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.timeout, 1);
  assert.equal(summary.parseFail, 1);
  assert.equal(summary.httpError, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(listRetryableOutcomeEntries(null).length, 0);
});

test('final branch push: namespace and markup helpers cover normalization fallbacks', () => {
  const { document } = parseHTML(`
    <html>
      <body>
        <nav><a href="">No href</a></nav>
        <nav><a href="https://www.pbinfo.ro/utilizator/9/tester">Tester</a></nav>
      </body>
    </html>
  `);
  const target = document.createElement('div');

  assert.equal(detectPbinfoUserNamespace(document), '9:tester');
  assert.deepEqual(parseSupportedTag(null), null);
  assert.deepEqual(parseSupportedTag('<span   >'), { kind: 'open', tagName: 'span', attrs: {} });
  assert.equal(sanitizeHref('/safe', 'not a valid base'), null);

  appendSimpleMarkup(target, '<a href="/problema/1">ok</a>', { baseUrl: '   ' });
  assert.equal(target.querySelector('a').href, 'https://www.pbinfo.ro/problema/1');
});
