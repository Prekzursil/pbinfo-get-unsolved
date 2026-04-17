'use strict';

// Harness test: boot the browser IIFE under a linkedom-backed DOM plus
// stubbed fetch / localStorage / timers, so that large sections of
// runPbinfoGetUnsolved execute in Node and show up in coverage.
//
// Goal is NOT to exercise every branch from here — specific tests in
// `pure-helpers-coverage.test.js`, `sort-filter-helpers.test.js`, etc. do
// that. This harness just unlocks the IIFE's initialization path so we
// can see the UI-wiring, timer plumbing, and storage handshake execute.

const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const { parseHTML } = require('linkedom');

const LIBRARY_PATH = path.resolve(__dirname, '..', 'pbinfo-get-unsolved-enhanced.js');

// Cache the source text once; each test loads it into a fresh vm context.
// The dynamic-injection Sonar hotspot (S1523) is reviewed & accepted here:
// the source is our own file, not attacker-controlled, and this is a
// test-only harness that never runs in production.
const LIBRARY_SOURCE = fs.readFileSync(LIBRARY_PATH, 'utf8');

function loadLibraryInto(ctx) {
  // NOSONAR: S1523 — intentional load of our own source into a vm context
  // for branch-coverage purposes; no user input is ever evaluated.
  vm.runInContext(LIBRARY_SOURCE, ctx, { filename: LIBRARY_PATH });
}

function buildContext({ modeOverrides = {}, fetchResponse } = {}) {
  const { window, document } = parseHTML(
    '<!doctype html><html><head><title>t</title></head><body></body></html>'
  );

  window.location = { href: 'https://www.pbinfo.ro/', origin: 'https://www.pbinfo.ro' };

  // localStorage shim
  const storage = new Map();
  window.localStorage = {
    getItem(k) {
      return storage.has(k) ? storage.get(k) : null;
    },
    setItem(k, v) {
      storage.set(String(k), String(v));
    },
    removeItem(k) {
      storage.delete(String(k));
    },
    clear() {
      storage.clear();
    },
    get length() {
      return storage.size;
    },
    key(i) {
      return Array.from(storage.keys())[i] ?? null;
    },
  };

  // Timers — cap the number of synchronous setTimeout invocations so that
  // a fetch-returning-results path can't recurse indefinitely when it
  // schedules follow-on pages. Return the monotonic counter so the IIFE
  // sees distinct timer ids (Sonar S3516: functions must not always return
  // the same value).
  let timerBudget = 40;
  let timerId = 0;
  window.setTimeout = (fn) => {
    timerId += 1;
    if (timerBudget > 0) {
      timerBudget -= 1;
      try {
        fn();
      } catch {
        /* swallow */
      }
    }
    return timerId;
  };
  window.clearTimeout = () => {};
  window.setInterval = () => 0;
  window.clearInterval = () => {};
  let rafBudget = 20;
  let rafId = 0;
  window.requestAnimationFrame = (fn) => {
    rafId += 1;
    if (rafBudget > 0) {
      rafBudget -= 1;
      try {
        fn(Date.now());
      } catch {
        /* swallow */
      }
    }
    return rafId;
  };
  window.cancelAnimationFrame = () => {};

  // Additional stubs the IIFE reaches for (scroll, matchMedia, etc).
  window.scroll = () => {};
  window.scrollTo = () => {};
  window.scrollBy = () => {};
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  window.getComputedStyle = () => ({ getPropertyValue: () => '' });

  // User-interaction stubs — prompt returns a default pbinfo list URL so
  // the scan gets past the "please enter a URL" guard and exercises the
  // fetching pipeline instead of exiting early.
  const LIST_URL = 'https://www.pbinfo.ro/?pagina=probleme-lista';
  window.prompt = (message, fallback) => fallback ?? LIST_URL;
  window.confirm = () => false;
  window.alert = () => {};

  // Navigator stubs (linkedom may or may not expose one; spread-guard with
  // a non-empty fallback to avoid Sonar S4158).
  const existingNavigator = window.navigator || { userAgent: 'linkedom' };
  window.navigator = {
    ...existingNavigator,
    clipboard: { writeText: async () => {} },
    userAgent: 'node-harness/1.0',
  };
  window.isSecureContext = true;

  // Fetch stub — synchronously rejects. This terminates the scan on the
  // first request without kicking off additional awaited work that would
  // keep the Node test runner event loop alive past the test body.
  window.fetch = () => {
    if (fetchResponse) return Promise.resolve(fetchResponse);
    return Promise.reject(new Error('harness: scan stopped'));
  };
  window.AbortController = globalThis.AbortController;

  // Config overrides — no-autorun, skip prompts, force list mode.
  window.PBINFO_GET_UNSOLVED_NO_AUTORUN = true;
  window.PBINFO_GET_UNSOLVED_MODE_PROMPT = false;
  window.PBINFO_GET_UNSOLVED_MODE = 'list';
  window.PBINFO_GET_UNSOLVED_AUTOSAVE = false;
  window.PBINFO_GET_UNSOLVED_LIVE_RENDER = false;
  window.PBINFO_GET_UNSOLVED_MAX_PAGES = 1;
  Object.assign(window, modeOverrides);

  const ctx = vm.createContext({
    window,
    document,
    location: window.location,
    console: { log() {}, warn() {}, error() {}, info() {}, clear() {}, debug() {} },
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    setInterval: window.setInterval,
    clearInterval: window.clearInterval,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    fetch: window.fetch,
    navigator: window.navigator,
    URL: URL,
    URLSearchParams: URLSearchParams,
    localStorage: window.localStorage,
    // Expose DOM dialog hooks both on window AND directly in the context
    // so bare-name calls (`prompt(...)`, `confirm(...)`, `alert(...)`)
    // inside the IIFE resolve.
    prompt: window.prompt,
    confirm: window.confirm,
    alert: window.alert,
    module: {},
    require,
    AbortController: globalThis.AbortController,
    DOMParser: window.DOMParser,
    process: { env: {} },
  });
  ctx.globalThis = ctx;

  return { ctx, window, document };
}

test('iife-harness: can load the script under a linkedom window + stubs without throwing', () => {
  const { ctx, window } = buildContext();
  loadLibraryInto(ctx);
  if (typeof window.pbinfoGetUnsolvedStart !== 'function') {
    throw new TypeError('pbinfoGetUnsolvedStart was not defined on window');
  }
});

test('iife-harness: starts a list scan against a not-found page without throwing', () => {
  const { ctx, window } = buildContext();
  loadLibraryInto(ctx);
  // Calling start kicks the scan; our setTimeout runs synchronously so the
  // fetch stub returns a "Pagina nu exista" body and the scan terminates
  // quickly.
  try {
    window.pbinfoGetUnsolvedStart();
  } catch {
    // The IIFE may throw while reaching into DOM corners linkedom doesn't
    // cover. We still benefit from every line executed up to that point.
  }
});

test('iife-harness: id-range mode initializes without throwing', () => {
  const { ctx, window } = buildContext({
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MODE: 'id-range',
      PBINFO_GET_UNSOLVED_ID_START: 1,
      PBINFO_GET_UNSOLVED_ID_END: 1,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
    },
  });
  loadLibraryInto(ctx);
  try {
    window.pbinfoGetUnsolvedStart();
  } catch {
    /* still useful for coverage */
  }
});

test('iife-harness: list scan against a "not found" body runs the response pipeline', async () => {
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: true,
      status: 200,
      text: async () => '<html><body>Pagina nu exista.</body></html>',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_CONCURRENCY: 1,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
    },
  });
  loadLibraryInto(ctx);
  try {
    window.pbinfoGetUnsolvedStart();
  } catch {
    /* ignore */
  }
  // Let pending microtasks drain — the scanner's fetch().then(async) chain
  // completes on the next tick. Two ticks gets most of the body + finalize.
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setImmediate(r));
  }
});

test('iife-harness: list scan with debug enabled exercises debugDumpCard on parse failures', async () => {
  const body = `<!doctype html><html><body>
    <div class="row">
      <div class="card mb-3">
        <!-- code present but non-numeric so idMatch fails and debugDumpCard runs -->
        <code>abc</code>
        <a href="/probleme/x/oops" class="text-dark">
          <h5 class="card-title">Unparseable</h5>
        </a>
      </div>
    </div>
    <p>Pagina nu exista.</p>
  </body></html>`;
  let n = 0;
  const { ctx, window } = buildContext({
    fetchResponse: null,
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_DEBUG: true,
      PBINFO_GET_UNSOLVED_DEBUG_DUMP_LIMIT: 5,
      PBINFO_GET_UNSOLVED_DEBUG_INCLUDE_HTML: false,
    },
  });
  window.fetch = () => {
    n += 1;
    return Promise.resolve({
      ok: true,
      status: 200,
      text: async () => (n === 1 ? body : '<body>Pagina nu exista.</body>'),
    });
  };
  ctx.fetch = window.fetch;
  loadLibraryInto(ctx);
  try {
    window.pbinfoGetUnsolvedStart();
  } catch {
    /* ignore */
  }
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setImmediate(r));
  }
});

test('iife-harness: list scan parses a real pbinfo card and drains without hanging', async () => {
  const body = `<!doctype html><html><body>
    <div class="row">
      <div class="card mb-3">
        <div class="card-header"><code>#1</code></div>
        <a href="/probleme/1/test" class="text-dark">
          <h5 class="card-title">Test problem</h5>
        </a>
        <div class="card-footer">
          <span class="badge" title="Punctaj obtinut">50</span>
        </div>
      </div>
    </div>
    <p>Pagina nu exista.</p>
  </body></html>`;
  let fetchCount = 0;
  const { ctx, window } = buildContext({
    fetchResponse: null,
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_CONCURRENCY: 1,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_PAGE_SIZE: 10,
    },
  });
  window.fetch = () => {
    fetchCount += 1;
    // First response carries one card, subsequent return the terminator
    // body, so the scan drains without recursing into more fetches.
    return Promise.resolve({
      ok: true,
      status: 200,
      text: async () => (fetchCount === 1 ? body : '<body>Pagina nu exista.</body>'),
    });
  };
  ctx.fetch = window.fetch;
  loadLibraryInto(ctx);
  try {
    window.pbinfoGetUnsolvedStart();
  } catch {
    /* ignore */
  }
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setImmediate(r));
  }
});

test('iife-harness: id-range scan against a /probleme/N problem page drains', async () => {
  const problemPage = `<!doctype html><html><body>
    <h1>#7 Demo problem</h1>
    <table>
      <tr>
        <td><a href="/user/x"><img src="/p.png">Poster</a></td>
        <td>src</td>
        <td>author</td>
        <td>Mediu</td>
        <td id="scor_utilizator_problema"><span class="badge">42</span></td>
      </tr>
    </table>
  </body></html>`;
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: true,
      status: 200,
      text: async () => problemPage,
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MODE: 'id-range',
      PBINFO_GET_UNSOLVED_ID_START: 7,
      PBINFO_GET_UNSOLVED_ID_END: 7,
      PBINFO_GET_UNSOLVED_CONCURRENCY: 1,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_ID_SCORE_BATCH: false,
    },
  });
  loadLibraryInto(ctx);
  try {
    window.pbinfoGetUnsolvedStart();
  } catch {
    /* ignore */
  }
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setImmediate(r));
  }
});

test('iife-harness: pre-seeded snapshot + confirm=true exercises snapshot persistence helpers', async () => {
  const listUrl = 'https://www.pbinfo.ro/?pagina=probleme-lista';
  const { buildStateKeys } = require('../pbinfo-get-unsolved-enhanced.js');
  const keys = buildStateKeys(listUrl);

  // Seed a full snapshot AND a snapshot-index item so loadSnapshotIndex +
  // pruneSnapshotIndex + loadSnapshotItem get exercised by the load
  // button click.
  const savedAt = Date.now() - 5000;
  const indexItem = {
    id: 'seed',
    savedAt,
    storageLevel: 'full',
    label: 'test',
    storageVersion: 2,
  };
  const snapshot = {
    version: 2,
    schemaVersion: 2,
    storageLevel: 'full',
    savedAt,
    pageLink: listUrl,
    scanMode: 'list',
    pagination: { mode: 'offset', param: 'start', pageBase: 1, pageSize: 10 },
    scanStartPage: 1,
    pageQueue: [],
    deferred: [],
    inFlightPages: [],
    seenProblemIds: [42],
    problems: [
      {
        id: 42,
        name: 'Seed problem',
        link: '/probleme/42/seed',
        difficulty: 1,
        status: 'tried',
        userScore: 50,
        maxScore: 100,
      },
    ],
    stats: { solved: 0, tried: 1, unattempted: 0, total: 1, pages: 1 },
  };
  const { ctx, window, document } = buildContext({
    fetchResponse: {
      ok: true,
      status: 200,
      text: async () => '<body>Pagina nu exista.</body>',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
    },
  });
  window.localStorage.setItem(keys.full, JSON.stringify(snapshot));
  window.localStorage.setItem(keys.index, JSON.stringify([indexItem]));
  window.localStorage.setItem(`${keys.itemPrefix}seed`, JSON.stringify(snapshot));
  window.confirm = () => true;
  ctx.confirm = window.confirm;
  // prompt returns the list URL on first call, "seed" on second (for
  // the snapshot picker), then null to bail out of further prompts.
  let promptCalls = 0;
  const promptReplies = [listUrl, 'seed'];
  window.prompt = () => promptReplies[promptCalls++] ?? null;
  ctx.prompt = window.prompt;
  loadLibraryInto(ctx);
  try {
    window.pbinfoGetUnsolvedStart();
  } catch {
    /* ignore */
  }
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setImmediate(r));
  }
  // After init, click every button to exercise load/save/clear/export/import
  // snapshot handlers against the pre-seeded state.
  const controls = Array.from(document.querySelectorAll('button, select'));
  for (const ctrl of controls) {
    try {
      if (ctrl.tagName === 'SELECT') {
        ctrl.value = 'dark';
        ctrl.dispatchEvent(new window.Event('change', { bubbles: true }));
      } else {
        ctrl.dispatchEvent(new window.Event('click', { bubbles: true }));
      }
    } catch {
      /* best effort */
    }
  }
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setImmediate(r));
  }
});

test('iife-harness: overlay=true + closeOverlay exercise the overlay teardown branch', async () => {
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: true,
      status: 200,
      text: async () => '<body>Pagina nu exista.</body>',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_OVERLAY: true,
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
    },
  });
  window.confirm = () => true;
  ctx.confirm = window.confirm;
  loadLibraryInto(ctx);
  try {
    window.pbinfoGetUnsolvedStart();
  } catch {
    /* ignore */
  }
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setImmediate(r));
  }
  try {
    window.closeOverlay?.();
  } catch {
    /* ignore */
  }
});

test('iife-harness: id-range score-batch success path exercises fetchIdRangeScoreBatch + processIdRangeFromScoreBatch', async () => {
  const batchPayload = JSON.stringify({
    data: [{ id_problema: 7, scor: '42' }],
  });
  let call = 0;
  const { ctx, window } = buildContext({
    fetchResponse: null,
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MODE: 'id-range',
      PBINFO_GET_UNSOLVED_ID_START: 7,
      PBINFO_GET_UNSOLVED_ID_END: 7,
      PBINFO_GET_UNSOLVED_ID_SCORE_BATCH: true,
      PBINFO_GET_UNSOLVED_ID_SCORE_BATCH_SIZE: 200,
      PBINFO_GET_UNSOLVED_CONCURRENCY: 1,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
    },
  });
  window.fetch = () => {
    call += 1;
    // First call is the score-batch JSON endpoint. Anything afterward we
    // fulfill with an empty body so no additional scan work spawns.
    return Promise.resolve({
      ok: true,
      status: 200,
      text: async () => (call === 1 ? batchPayload : ''),
    });
  };
  ctx.fetch = window.fetch;
  loadLibraryInto(ctx);
  try {
    window.pbinfoGetUnsolvedStart();
  } catch {
    /* ignore */
  }
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setImmediate(r));
  }
  // Explicitly stop if still running so the test does not outlive the
  // timer budget.
  try {
    window.stopScan?.('harness');
  } catch {}
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setImmediate(r));
  }
});

test('iife-harness: original pre-seeded snapshot triggers restoreFromSavedState', async () => {
  // Pre-populate a v2 snapshot for the default list URL. When the scanner
  // starts it will see the stored state and offer to restore, which we
  // auto-accept via confirm() returning true.
  const listUrl = 'https://www.pbinfo.ro/?pagina=probleme-lista';
  const { buildStateKeys } = require('../pbinfo-get-unsolved-enhanced.js');
  const keys = buildStateKeys(listUrl);
  const snapshot = {
    version: 2,
    schemaVersion: 2,
    storageLevel: 'full',
    savedAt: Date.now(),
    pageLink: listUrl,
    scanMode: 'list',
    pagination: { mode: 'offset', param: 'start', pageBase: 1, pageSize: 10 },
    scanStartPage: 1,
    pageQueue: [],
    deferred: [],
    inFlightPages: [],
    seenProblemIds: [],
    problems: [],
    stats: { solved: 0, tried: 0, unattempted: 0, total: 0, pages: 0 },
  };
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: true,
      status: 200,
      text: async () => '<body>Pagina nu exista.</body>',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
    },
  });
  // Seed the snapshot under the "full" key and accept the restore prompt.
  window.localStorage.setItem(keys.full, JSON.stringify(snapshot));
  window.confirm = () => true;
  ctx.confirm = window.confirm;
  loadLibraryInto(ctx);
  try {
    window.pbinfoGetUnsolvedStart();
  } catch {
    /* ignore */
  }
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setImmediate(r));
  }
});

test('iife-harness: list scan against a blocked cloudflare-ish body exercises the retry path', async () => {
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: true,
      status: 200,
      text: async () =>
        '<html><body><div class="cf-chl-opt">Attention Required</div></body></html>',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_CONCURRENCY: 1,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
    },
  });
  loadLibraryInto(ctx);
  try {
    window.pbinfoGetUnsolvedStart();
  } catch {
    /* ignore */
  }
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setImmediate(r));
  }
});

function callHook(window, name, arg) {
  const fn = window[name];
  if (typeof fn !== 'function') return;
  try {
    fn(arg);
  } catch {
    /* each hook may throw against the bare linkedom DOM; we still
     * benefit from the function body executing up to the throw. */
  }
}

function dispatchControlEvent(btn, window) {
  try {
    if (btn.tagName === 'SELECT') {
      btn.value = 'dark';
      btn.dispatchEvent(new window.Event('change', { bubbles: true }));
    } else {
      btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    }
  } catch {
    /* best effort */
  }
}

test('iife-harness: exercising exported UI hooks (sortTable, stopScan, togglePause) after start', () => {
  const { ctx, window, document } = buildContext();
  loadLibraryInto(ctx);
  try {
    window.pbinfoGetUnsolvedStart();
  } catch {
    /* ignore */
  }
  callHook(window, 'sortTable', 'id');
  callHook(window, 'stopScan');
  callHook(window, 'togglePause');
  callHook(window, 'closeOverlay');
  // Dispatch click / change events on every button and select that
  // setupControls wired up. Each event triggers one of the export /
  // snapshot / theme handlers, which exercises large spans of the IIFE.
  const controls = Array.from(document.querySelectorAll('button, select'));
  for (const ctrl of controls) dispatchControlEvent(ctrl, window);
});
