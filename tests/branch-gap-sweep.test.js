const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');

const {
  createOutcomeLedger,
  recordOutcomeEntry,
  summarizeOutcomeLedger,
  listRetryableOutcomeEntries,
  parseTotalProblems,
  normalizeListUrl,
  buildPageUrl,
  computeBackoffWithJitter,
  nextAdaptiveThrottleState,
  detectPbinfoUserNamespace,
} = require('../src/core');
const {
  appendSimpleMarkup,
  createAllowedElement,
  sanitizeHref,
  extractColorFromStyle,
  readAttributeEntry,
  parseSupportedTag,
} = require('../src/core/log-markup');
const { storageSet, queryTabs, sendTabMessage, openTab } = require('../src/shell-extension/shared');

function getDocument(html) {
  return parseHTML(html).document;
}

function runStorageSet(values, api) {
  return new Promise((resolve) => {
    storageSet(values, resolve, api);
  });
}

function runQueryTabs(query, api) {
  return new Promise((resolve) => {
    queryTabs(query, resolve, api);
  });
}

function runSendTabMessage(tabId, message, api) {
  return new Promise((resolve) => {
    sendTabMessage(tabId, message, resolve, api);
  });
}

function createRejectingStorageApi() {
  const api = {};
  api.storage = {};
  api.storage.local = {};
  api.storage.local.set = function () {
    return Promise.reject(new Error('storage.set failed'));
  };
  return api;
}

function createCallbackStorageApi() {
  const api = {};
  api.storage = {};
  api.storage.local = {};
  api.storage.local.set = function (_values, callback) {
    callback();
  };
  api.runtime = {};
  return api;
}

function createNonArrayQueryTabsApi() {
  const api = {};
  api.tabs = {};
  api.tabs.query = function (_query, callback) {
    callback('not-an-array');
  };
  api.runtime = {};
  return api;
}

function createCallbackSendMessageApi() {
  const api = {};
  api.tabs = {};
  api.tabs.sendMessage = function (_tabId, _message, callback) {
    callback(undefined);
  };
  api.runtime = {};
  return api;
}

function createRejectingSendMessageApi() {
  const api = {};
  api.tabs = {};
  api.tabs.sendMessage = function () {
    return Promise.reject(new Error('sendMessage failed'));
  };
  return api;
}

function seedOutcomeLedgerForBranchSweep() {
  const ledger = createOutcomeLedger();
  const unknown = recordOutcomeEntry(ledger, {
    targetType: '',
    targetKey: null,
    status: 'mystery',
    retryCount: -1,
    durationMs: -5,
    updatedAt: 'bad',
  });
  const rateLimited = recordOutcomeEntry(ledger, {
    targetType: 'list-page',
    targetKey: 5,
    status: 'rate_limited',
    retryCount: 2,
    durationMs: 20,
    updatedAt: 123,
  });
  const httpError = recordOutcomeEntry(ledger, {
    targetType: 'verify',
    targetKey: '9',
    status: 'http_error',
    retryCount: 0,
    durationMs: 10,
  });
  recordOutcomeEntry(ledger, {
    targetType: 'verify',
    targetKey: '10',
    status: 'skipped',
  });
  return { ledger, unknown, rateLimited, httpError };
}

test('branch gap sweep: outcome helpers normalize aliases, fallbacks, and retryability', () => {
  const seeded = createOutcomeLedger({});
  assert.deepEqual(seeded, { entries: {} });
  assert.equal(recordOutcomeEntry(null, {}), null);

  const { ledger, unknown, rateLimited, httpError } = seedOutcomeLedgerForBranchSweep();

  assert.equal(unknown.key, 'unknown:?');
  assert.equal(unknown.retryCount, 0);
  assert.equal(unknown.durationMs, 0);
  assert.equal(rateLimited.status, 'rate-limited');
  assert.equal(httpError.status, 'http-error');

  const summary = summarizeOutcomeLedger(ledger);
  assert.equal(summary.rateLimited, 1);
  assert.equal(summary.httpError, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.unknown, 1);
  assert.equal(summary.unknowns, 3);
  assert.deepEqual(
    listRetryableOutcomeEntries(ledger)
      .map((entry) => entry.key)
      .sort((left, right) => left.localeCompare(right)),
    ['list-page:5', 'unknown:?', 'verify:9']
  );
});

test('branch gap sweep: network helpers cover default and negative selector paths', () => {
  const doc = getDocument(`
    <html>
      <body>
        <main>
          <a href="https://www.pbinfo.ro/utilizator/7/article-user">Article user</a>
        </main>
        <nav>
          <a href="https://www.pbinfo.ro/utilizator/not-a-match">Ignored</a>
        </nav>
      </body>
    </html>
  `);

  assert.equal(parseTotalProblems(), null);
  assert.equal(normalizeListUrl('', ''), null);
  assert.equal(buildPageUrl('https://www.pbinfo.ro/', { pageIndex: 'bad' }), null);
  assert.equal(computeBackoffWithJitter(Number.NaN, { baseMs: 0, capMs: 25, random: () => 2 }), 1);
  assert.deepEqual(nextAdaptiveThrottleState({}, 'blocked', { capMs: 20 }), {
    enabled: true,
    baseDelayMs: 0,
    baseConcurrency: 1,
    delayMs: 20,
    concurrency: 1,
    cleanStreak: 0,
  });
  assert.deepEqual(nextAdaptiveThrottleState({}, 'error', { capMs: 200 }), {
    enabled: true,
    baseDelayMs: 0,
    baseConcurrency: 1,
    delayMs: 200,
    concurrency: 1,
    cleanStreak: 0,
  });
  assert.equal(detectPbinfoUserNamespace(null), null);
  assert.equal(detectPbinfoUserNamespace(doc), null);
});

test('branch gap sweep: shell shared storage and query fallbacks cover callback and promise branches', async () => {
  const storageSetResults = [
    await runStorageSet({ hello: 'world' }, createRejectingStorageApi()),
    await runStorageSet({ hello: 'world' }, createCallbackStorageApi()),
  ];
  const tabQueryResults = [
    await runQueryTabs({}, {}),
    await runQueryTabs({}, createNonArrayQueryTabsApi()),
  ];

  assert.equal(storageSetResults.length, 2);
  assert.match(String(storageSetResults[0]), /storage\.set failed/);
  assert.equal(storageSetResults[1], null);
  assert.deepEqual(tabQueryResults, [[], []]);
});

test('branch gap sweep: shell shared messaging fallbacks and openTab creation stay explicit', async () => {
  const callbackMessageBridge = createCallbackSendMessageApi();
  const rejectingMessageBridge = createRejectingSendMessageApi();
  const tabMessageResults = [
    await runSendTabMessage(1, {}, {}),
    await runSendTabMessage(1, {}, rejectingMessageBridge),
    await runSendTabMessage(2, {}, callbackMessageBridge),
  ];
  const openedUrls = [];
  openTab('https://www.pbinfo.ro/', {
    tabs: {
      create({ url }) {
        openedUrls.push(url);
      },
    },
  });

  assert.deepEqual(tabMessageResults, [
    { ok: false, error: 'tabs.sendMessage unavailable' },
    { ok: false, error: 'sendMessage failed' },
    { ok: false, error: 'no response' },
  ]);
  assert.deepEqual(openedUrls, ['https://www.pbinfo.ro/']);
});

test('branch gap sweep: log markup helpers cover nullish and malformed branches', () => {
  const document = getDocument('<html><body><div id="target"></div></body></html>');
  const target = document.getElementById('target');

  assert.equal(extractColorFromStyle('display:block'), '');
  assert.equal(readAttributeEntry('="broken"', 0), null);
  assert.equal(parseSupportedTag(' < > '), null);
  assert.equal(createAllowedElement('script', {}, document, 'https://www.pbinfo.ro/'), null);
  assert.equal(sanitizeHref('ftp://example.com/resource', 'https://www.pbinfo.ro/%'), null);

  appendSimpleMarkup(target, '', {});
  appendSimpleMarkup(target, '<br/>', {});
  appendSimpleMarkup(target, '</missing>', {});

  assert.equal(target.innerHTML, '<br>&lt;/missing&gt;');
});
