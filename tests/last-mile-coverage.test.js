const test = require('node:test');
const assert = require('node:assert/strict');

const { parseHTML } = require('linkedom');

const {
  buildSetupWizardDefaults,
  showSetupWizard,
  createParsedCacheEntry,
  isParsedCacheEntryFresh,
  normalizeListUrl,
  parseRetryAfterMs,
  detectPbinfoUserNamespace,
  createOutcomeLedger,
  summarizeOutcomeLedger,
  pickNextNavigationProblem,
  createNavigationState,
  extractScoreInfoFromProblemPage,
} = require('../src/core');
const { getApi } = require('../src/shell-extension/shared');

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

test('last-mile coverage: wizard fallback fields and current-source submit path stay covered', async () => {
  const config = createConfig();
  const { document } = parseHTML('<html><body></body></html>');
  const promise = showSetupWizard({
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    config,
    defaults: buildSetupWizardDefaults({
      setupDefaults: {
        scanMode: 'list',
        sourceMode: 'current',
        pageLink: '',
        idRange: '',
        startPage: 0,
        speedPreset: '',
      },
      modeFromWindow: 'list',
      defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
      config,
    }),
    overlayEnabled: true,
    localStorageApi: createLocalStorage(),
    documentRef: document,
    locationRef: { origin: 'https://www.pbinfo.ro' },
    setSelectOptions,
  });

  const urlInput = document.querySelector('[data-role="setup-url"]');
  const rangeInput = document.querySelector('[data-role="setup-range"]');
  const startInput = document.querySelector('[data-role="setup-start"]');
  const speedSelect = document.querySelector('[data-role="setup-speed"]');
  const sourceSelect = document.querySelector('[data-role="setup-source"]');
  const summary = document.querySelector('[data-role="setup-summary"]');

  assert.equal(urlInput.value, 'https://www.pbinfo.ro/?pagina=probleme-lista');
  assert.equal(rangeInput.value, '10-20');
  assert.equal(startInput.value, '0');
  assert.equal(speedSelect.value || 'balanced', 'balanced');

  startInput.value = '';
  startInput.dispatchEvent(new document.defaultView.Event('input'));
  assert.match(summary.textContent, /de la 0/);

  sourceSelect.options[0].selected = true;
  sourceSelect.dispatchEvent(new document.defaultView.Event('change'));
  document.querySelector('[data-role="setup-start-button"]').click();

  assert.deepEqual(await promise, {
    scanMode: 'list',
    pageLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    startPage: 1,
    idRange: null,
    verifyUnsolved: false,
    forceRefresh: false,
    resumeSavedState: true,
    speedPreset: 'balanced',
    concurrency: 2,
    delayMs: 125,
    sourceMode: 'current',
  });
});

test('last-mile coverage: cache freshness accepts explicit identity matches', () => {
  const entry = createParsedCacheEntry({
    now: 1000,
    ttlMs: 5000,
    schemaVersion: 2,
    cacheKind: 'verify',
    cacheKey: 'batch:7',
    userNamespace: '12:tester',
  });

  assert.equal(entry.schemaVersion, 2);
  assert.equal(entry.cacheKind, 'verify');
  assert.equal(entry.cacheKey, 'batch:7');
  assert.equal(
    isParsedCacheEntryFresh(entry, {
      now: 2000,
      cacheKind: 'verify',
      cacheKey: 'batch:7',
      userNamespace: '12:tester',
    }),
    true
  );
});

test('last-mile coverage: network helpers cover base-url fallback, overflow retry-after, and href-less roots', () => {
  assert.equal(
    normalizeListUrl('', 'https://www.pbinfo.ro/?pagina=probleme-lista&start=20', 'start'),
    'https://www.pbinfo.ro/?pagina=probleme-lista'
  );
  assert.equal(parseRetryAfterMs('9'.repeat(400), 0), null);

  const fakeRoot = {
    querySelectorAll() {
      return [
        {
          closest() {
            return null;
          },
        },
      ];
    },
  };

  assert.equal(detectPbinfoUserNamespace(fakeRoot), null);
});

test('last-mile coverage: seeded outcome ledgers cover summary branches directly', () => {
  const summary = summarizeOutcomeLedger(
    createOutcomeLedger([
      { targetType: 'page', targetKey: 1, status: 'success', updatedAt: 1 },
      { targetType: 'page', targetKey: 2, status: 'blocked', updatedAt: 1 },
      { targetType: 'page', targetKey: 3, status: 'timeout', updatedAt: 1 },
      { targetType: 'page', targetKey: 4, status: 'skipped', updatedAt: 1 },
    ])
  );

  assert.equal(summary.success, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.timeout, 1);
  assert.equal(summary.skipped, 1);
});

test('last-mile coverage: navigation all-scope uses link identity and bad option fallback safely', () => {
  const navState = createNavigationState();

  assert.equal(pickNextNavigationProblem(navState, 'bad-options'), null);
  assert.equal(
    pickNextNavigationProblem(navState, {
      scope: 'all',
      visibleProblems: [],
      allProblems: [{ status: 'tried', link: 'https://www.pbinfo.ro/problema/77' }],
    }).link,
    'https://www.pbinfo.ro/problema/77'
  );
});

test('last-mile coverage: browser-first api selection and problem-page ratio parsing stay explicit', () => {
  const originalBrowser = globalThis.browser;
  const originalChrome = globalThis.chrome;
  globalThis.browser = { runtime: { id: 'browser-api' } };
  globalThis.chrome = { runtime: { id: 'chrome-api' } };

  try {
    assert.equal(getApi().runtime.id, 'browser-api');
  } finally {
    if (originalBrowser === undefined) {
      delete globalThis.browser;
    } else {
      globalThis.browser = originalBrowser;
    }
    if (originalChrome === undefined) {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = originalChrome;
    }
  }

  const { document } = parseHTML(`
    <table>
      <tr>
        <td id="scor_utilizator_problema"><span>42 / 100</span></td>
      </tr>
    </table>
  `);
  const scoreInfo = extractScoreInfoFromProblemPage(document);

  assert.equal(scoreInfo.userScore, 42);
  assert.equal(scoreInfo.maxScore, 100);
});
