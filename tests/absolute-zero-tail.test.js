const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');

const {
  createParsedCacheEntry,
  isParsedCacheEntryFresh,
  createNavigationState,
  pickNextNavigationProblem,
  showSetupWizard,
  parseSupportedTag,
  appendSimpleMarkup,
} = require('../src/core');
const { getApi } = require('../src/shell-extension/shared');

function createConfig() {
  return {
    startPage: 3,
    concurrency: 2,
    delayMs: 125,
    pagination: { param: 'start' },
    idRange: { startId: 10, endId: 20 },
    cache: { enabled: true, forceRefresh: false },
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

test('absolute zero tail: shell globals fallback to null API and restore host globals', () => {
  const previousBrowser = globalThis.browser;
  const previousChrome = globalThis.chrome;

  delete globalThis.browser;
  delete globalThis.chrome;
  try {
    assert.equal(getApi(), null);
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

test('absolute zero tail: cache fallbacks hit final branches', () => {
  const entry = createParsedCacheEntry({
    cacheKind: '   ',
    cacheKey: '42',
    userNamespace: 'user',
    now: 10,
    ttlMs: 10,
  });

  assert.equal(entry.cacheKind, 'unknown');
  assert.equal(
    isParsedCacheEntryFresh(entry, {
      now: 12,
      cacheKind: 'unknown',
      cacheKey: '42',
      userNamespace: 'user',
    }),
    true
  );
  assert.equal(
    isParsedCacheEntryFresh(entry, { now: 12, cacheKind: 'verify-problem', userNamespace: 'user' }),
    false
  );
  assert.equal(
    isParsedCacheEntryFresh(entry, { now: 12, cacheKey: 'different', userNamespace: 'user' }),
    false
  );
  assert.equal(
    isParsedCacheEntryFresh(
      { expiresAt: 20, userNamespace: 'user' },
      { now: 12, cacheKind: 'unknown', userNamespace: 'user' }
    ),
    false
  );
  assert.equal(
    isParsedCacheEntryFresh(
      { expiresAt: 20, cacheKind: 'unknown', userNamespace: 'user' },
      { now: 12, cacheKey: '42', userNamespace: 'user' }
    ),
    false
  );
});

test('absolute zero tail: navigation fallbacks hit final branches', () => {
  const navState = createNavigationState();
  assert.equal(pickNextNavigationProblem(navState, 'bad-options'), null);
  assert.equal(pickNextNavigationProblem(navState, 0), null);
  assert.equal(
    pickNextNavigationProblem(navState, {
      scope: 'visible',
      visibleProblems: [{ status: 'tried' }],
      allProblems: [],
    }).status,
    'tried'
  );
  assert.equal(
    pickNextNavigationProblem(navState, {
      scope: 'all',
      visibleProblems: [{ status: 'solved' }],
      allProblems: [{ status: 'tried', link: 'https://www.pbinfo.ro/probleme/77/demo' }],
    }).link,
    'https://www.pbinfo.ro/probleme/77/demo'
  );
});

async function testAbsoluteZeroTailWizardAndMarkupFallbacks() {
  const parsedDom = parseHTML('<html><body><div id="target"></div></body></html>');
  const document = parsedDom.document;
  const window = parsedDom.window;
  const promise = showSetupWizard({
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    config: createConfig(),
    defaults: {
      scanMode: 'list',
      sourceMode: 'current',
      pageLink: '',
      idRange: '',
      startPage: 0,
      speedPreset: '',
      verifyUnsolved: false,
      forceRefresh: false,
      resumeSavedState: true,
    },
    overlayEnabled: true,
    localStorageApi: createLocalStorage(),
    documentRef: document,
    locationRef: { origin: 'https://www.pbinfo.ro' },
    setSelectOptions,
  });

  assert.equal(
    document.querySelector('[data-role="setup-url"]').value,
    'https://www.pbinfo.ro/?pagina=probleme-lista'
  );
  assert.equal(document.querySelector('[data-role="setup-range"]').value, '10-20');
  assert.equal(document.querySelector('[data-role="setup-speed"]').value, undefined);
  assert.deepEqual(parseSupportedTag('<span   >'), { kind: 'open', tagName: 'span', attrs: {} });

  const target = document.getElementById('target');
  appendSimpleMarkup(target, '<b>ok</b>', { baseUrl: '' });
  assert.equal(target.innerHTML, '<b>ok</b>');

  document.querySelector('[data-role="setup-cancel"]').dispatchEvent(new window.Event('click'));
  assert.equal(await promise, null);
}

test(
  'absolute zero tail: wizard field fallbacks and markup parsing cover the last branches',
  testAbsoluteZeroTailWizardAndMarkupFallbacks
);
