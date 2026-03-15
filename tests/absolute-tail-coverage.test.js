const test = require('node:test');
const assert = require('node:assert/strict');

const { parseHTML } = require('linkedom');

const {
  showSetupWizard,
  createParsedCacheEntry,
  isParsedCacheEntryFresh,
  listNavigationCandidates,
  createNavigationState,
  pickNextNavigationProblem,
  parseTagAttributes,
  resolveBaseUrl,
  sanitizeHref,
  appendSafeCloseTag,
  appendSimpleMarkup,
} = require('../src/core');
const { getApi } = require('../src/shell-extension/shared');

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

function createLocalStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
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

async function testAbsoluteTailRawWizardDefaults() {
  const parsedDom = parseHTML('<html><body></body></html>');
  const document = parsedDom.document;
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
  assert.equal(document.querySelector('[data-role="setup-speed"]').value || 'balanced', 'balanced');
  document.querySelector('[data-role="setup-cancel"]').click();
  assert.equal(await promise, null);
}

test(
  'absolute tail: raw wizard defaults exercise fallback field initializers',
  testAbsoluteTailRawWizardDefaults
);

test('absolute tail: cache entry keeps explicit kind and zero-like key', () => {
  const entry = createParsedCacheEntry({
    now: 50,
    ttlMs: 100,
    cacheKind: 'verify',
    cacheKey: 0,
    userNamespace: 'u:1',
  });

  assert.equal(entry.cacheKind, 'verify');
  assert.equal(entry.cacheKey, '0');
  assert.equal(
    isParsedCacheEntryFresh(entry, {
      now: 60,
      cacheKind: 'verify',
      cacheKey: 0,
      userNamespace: 'u:1',
    }),
    true
  );
});

test('absolute tail: cache freshness rejects missing identity fields', () => {
  const entry = createParsedCacheEntry({
    now: 50,
    ttlMs: 100,
    cacheKind: 'verify',
    cacheKey: 0,
    userNamespace: 'u:1',
  });

  assert.equal(
    isParsedCacheEntryFresh(entry, {
      now: 60,
      cacheKind: 'verify',
      cacheKey: 0,
      userNamespace: 'u:1',
    }),
    true
  );
  assert.equal(
    isParsedCacheEntryFresh(
      {
        expiresAt: 100,
        userNamespace: 'u:1',
      },
      {
        now: 60,
        cacheKind: 'verify',
        userNamespace: 'u:1',
      }
    ),
    false
  );
  assert.equal(
    isParsedCacheEntryFresh(
      {
        cacheKind: 'verify',
        expiresAt: 100,
        userNamespace: 'u:1',
      },
      {
        now: 60,
        cacheKind: 'verify',
        cacheKey: 0,
        userNamespace: 'u:1',
      }
    ),
    false
  );
});

test('absolute tail: navigation uses missing-link identity fallback and bad options objects safely', () => {
  const navState = createNavigationState();
  const picked = pickNextNavigationProblem(navState, {
    scope: 'all',
    visibleProblems: null,
    allProblems: [{ status: 'tried' }],
  });

  assert.deepEqual(picked, { status: 'tried' });
  assert.equal(navState.signatures.all, '');
  assert.deepEqual(listNavigationCandidates(null), []);
});

test('absolute tail: getApi prefers browser before chrome', () => {
  const previousBrowser = globalThis.browser;
  const previousChrome = globalThis.chrome;
  globalThis.browser = { runtime: { id: 'browser-api' } };
  globalThis.chrome = { runtime: { id: 'chrome-api' } };

  try {
    assert.equal(getApi(), globalThis.browser);
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

test('absolute tail: log-markup internals cover trailing whitespace, document href fallback, and empty close names', () => {
  const parsedDom = parseHTML('<html><body><div id="target"></div></body></html>');
  const document = parsedDom.document;
  const target = document.getElementById('target');
  const fragment = document.createDocumentFragment();
  const fallbackWrites = [];

  Object.defineProperty(document, 'location', {
    configurable: true,
    value: { href: 'https://www.pbinfo.ro/lista' },
  });

  assert.deepEqual(parseTagAttributes('href="/safe"   '), { href: '/safe' });
  assert.equal(resolveBaseUrl(document, null), 'https://www.pbinfo.ro/lista');

  appendSafeCloseTag({ tagName: null, raw: '</>' }, [fragment], function (text) {
    fallbackWrites.push(text);
  });
  appendSimpleMarkup(target, '<a href="/problema/1">link</a>', null);
  const canParseDescriptor = Object.getOwnPropertyDescriptor(URL, 'canParse');
  Object.defineProperty(URL, 'canParse', {
    configurable: true,
    writable: true,
    value: undefined,
  });
  try {
    assert.equal(sanitizeHref('/problema/1', 'https://www.pbinfo.ro/'), null);
  } finally {
    if (canParseDescriptor) {
      Object.defineProperty(URL, 'canParse', canParseDescriptor);
    } else {
      delete URL.canParse;
    }
  }

  assert.deepEqual(fallbackWrites, ['</>']);
  assert.equal(target.querySelector('a').href, 'https://www.pbinfo.ro/problema/1');
});
