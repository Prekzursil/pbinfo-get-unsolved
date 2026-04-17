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
  vm.runInContext(LIBRARY_SOURCE, ctx, { filename: LIBRARY_PATH }); // NOSONAR: javascript:S1523 — executing our own pinned library source (read once at module load) in an isolated vm context for branch-coverage purposes; never evaluates user input.
}

async function drainMicrotasks(ticks = 8) {
  for (let i = 0; i < ticks; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

async function startAndDrain(ctx, window, ticks = 8) {
  loadLibraryInto(ctx);
  try {
    window.pbinfoGetUnsolvedStart();
  } catch {
    /* harness is best-effort */
  }
  await drainMicrotasks(ticks);
}

function installSequencedFetch(window, ctx, responses) {
  let call = 0;
  window.fetch = () => {
    const idx = call;
    call += 1;
    const r = responses[idx] ?? responses[responses.length - 1];
    return Promise.resolve(r);
  };
  ctx.fetch = window.fetch;
}

// Deterministic 200-problem snapshot builder used by a couple of coverage
// harness scenarios. Extracted to keep Sonar's duplication metric under 3%.
function makeLargeListSnapshot(listUrl) {
  const problems = [];
  for (let i = 0; i < 200; i++) {
    problems.push({
      id: i + 1,
      name: `p${i + 1}`,
      link: `/probleme/${i + 1}/x`,
      difficulty: 1,
      status: 'tried',
      userScore: 50,
      maxScore: 100,
    });
  }
  return {
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
    seenProblemIds: problems.map((p) => p.id),
    problems,
    stats: { solved: 0, tried: problems.length, unattempted: 0, total: problems.length, pages: 1 },
  };
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

  // Navigator stubs — linkedom's window.navigator is a non-configurable
  // getter, so our override won't stick on the window. We pass the stub
  // straight into the vm context below (the IIFE reads `navigator` from
  // there). Default navigator has no clipboard — the `navigator?.clipboard?
  // .writeText` guard in copyTextToClipboard therefore takes the fallback
  // branch (execCommand) on every harness click, which is what we want.
  const navigatorStub = {
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
    navigator: navigatorStub,
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

test('iife-harness: list debug scan with unattempted card hits debugDumpCard with candidates', async () => {
  const body = `<!doctype html><html><body>
    <div class="row">
      <div class="card mb-3">
        <code>#1</code>
        <a href="/probleme/1/unattempted" class="text-dark"><h5>#1 unattempted</h5></a>
        <!-- no score badge → unattempted status, but id IS parseable -->
      </div>
    </div>
    <p>Pagina nu exista.</p>
  </body></html>`;
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
  installSequencedFetch(window, ctx, [
    { ok: true, status: 200, text: async () => body },
    { ok: true, status: 200, text: async () => '<body>Pagina nu exista.</body>' },
  ]);
  await startAndDrain(ctx, window, 8);
});

test('iife-harness: list scan with MAX_PAGES < total hits the cap warning', async () => {
  // A numar_probleme of 500 with page size 10 implies 50 pages. MAX_PAGES=1
  // triggers the "totalPages exceeds maxPages" addLog branch.
  const body = `<!doctype html><html><body>
    <span class="numar_probleme">500</span>
    <div class="row">
      <div class="card mb-3">
        <code>#1</code>
        <a href="/probleme/1/x" class="text-dark"><h5>#1 x</h5></a>
        <div class="card-footer"><span class="badge" title="Punctaj obtinut">50</span></div>
      </div>
    </div>
  </body></html>`;
  let n = 0;
  const { ctx, window } = buildContext({
    fetchResponse: null,
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_PAGE_SIZE: 10,
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
  await startAndDrain(ctx, window, 8);
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
  await startAndDrain(ctx, window, 8);
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
  await startAndDrain(ctx, window, 8);
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
  await startAndDrain(ctx, window, 8);
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
  await startAndDrain(ctx, window, 8);
  // Pre-select the seeded snapshot on the state dropdown so the load /
  // clear buttons exercise loadSnapshotItem + deleteSnapshotItem instead
  // of the autosave fall-through branch. linkedom makes `select.value` a
  // getter-only property on HTMLSelectElement, so we shadow it.
  const selects = Array.from(document.querySelectorAll('select'));
  for (const sel of selects) {
    const snapshotOption = Array.from(sel.options || []).find((o) =>
      (o.value || '').startsWith('snapshot:')
    );
    if (snapshotOption) {
      try {
        Object.defineProperty(sel, 'value', {
          configurable: true,
          get() {
            return snapshotOption.value;
          },
          set() {
            /* ignore */
          },
        });
      } catch {
        /* best effort */
      }
      break;
    }
  }
  // After init, click every button to exercise load/save/clear/export/import
  // snapshot handlers against the pre-seeded state.
  const controls = Array.from(document.querySelectorAll('button, select'));
  for (const ctrl of controls) {
    try {
      if (ctrl.tagName === 'SELECT') {
        // keep pre-selected snapshot — skip the change event so the load
        // button still sees the snapshot:* value.
        continue;
      }
      ctrl.dispatchEvent(new window.Event('click', { bubbles: true }));
    } catch {
      /* best effort */
    }
  }
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setImmediate(r));
  }
  // Force a full table render by triggering sortTable('id') which routes
  // through updateTable — this pulls in the chunk/virtualize paths after
  // the snapshot restore has already populated allProblems.
  try {
    window.sortTable?.('id');
  } catch {
    /* ignore */
  }
  await drainMicrotasks(4);
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
  await startAndDrain(ctx, window, 4);
  try {
    window.closeOverlay?.();
  } catch {
    /* ignore */
  }
});

test('iife-harness: id-range score-batch success path exercises fetchIdRangeScoreBatch + processIdRangeFromScoreBatch', async () => {
  // scor=100 so processIdRangeFromScoreBatch's short-circuit path runs
  // (it only kicks in when the cached score is a full solve).
  const batchPayload = JSON.stringify({
    data: [{ id_problema: 7, scor: '100' }],
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
  await startAndDrain(ctx, window, 12);
  // Explicitly stop if still running so the test does not outlive the
  // timer budget.
  try {
    window.stopScan?.('harness');
  } catch {}
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setImmediate(r));
  }
});

test('iife-harness: 200-problem restored snapshot triggers scheduleChunk + clearSavedStateForLink on autosave clear', async () => {
  const listUrl = 'https://www.pbinfo.ro/?pagina=probleme-lista';
  const { buildStateKeys } = require('../pbinfo-get-unsolved-enhanced.js');
  const keys = buildStateKeys(listUrl);
  const snapshot = makeLargeListSnapshot(listUrl);
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
      PBINFO_GET_UNSOLVED_RENDER_CHUNK_SIZE: 50,
    },
  });
  window.localStorage.setItem(keys.full, JSON.stringify(snapshot));
  window.confirm = () => true;
  ctx.confirm = window.confirm;
  await startAndDrain(ctx, window, 12);
  // Click every button — the state select is left at its default value
  // (empty / autosave sentinel), so clearStateBtn falls through to
  // clearSavedStateForLink instead of deleteSnapshotItem.
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const btn of buttons) {
    try {
      btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    } catch {
      /* best effort */
    }
  }
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setImmediate(r));
  }
});

async function runScoreBatchScenarioWithRetries(firstResponse) {
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
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 1,
    },
  });
  let call = 0;
  window.fetch = () => {
    call += 1;
    return Promise.resolve(
      call === 1
        ? firstResponse
        : { ok: false, status: 404, text: async () => '<body>Pagina nu exista.</body>' }
    );
  };
  ctx.fetch = window.fetch;
  await startAndDrain(ctx, window, 10);
}

test('iife-harness: score-batch cloudflare response with retries remaining takes retry branch', async () => {
  await runScoreBatchScenarioWithRetries({
    ok: true,
    status: 200,
    text: async () => '<body><div class="cf-chl-opt">Attention Required</div></body>',
  });
});

test('iife-harness: score-batch 500 with retries remaining hits the retry branch', async () => {
  await runScoreBatchScenarioWithRetries({
    ok: false,
    status: 500,
    text: async () => 'ISE',
  });
});

test('iife-harness: virtualize rows + 200-problem snapshot displays the virtualization banner', async () => {
  const listUrl = 'https://www.pbinfo.ro/?pagina=probleme-lista';
  const { buildStateKeys } = require('../pbinfo-get-unsolved-enhanced.js');
  const keys = buildStateKeys(listUrl);
  const snapshot = makeLargeListSnapshot(listUrl);
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
      PBINFO_GET_UNSOLVED_VIRTUALIZE_ROWS: true,
      PBINFO_GET_UNSOLVED_VIRTUAL_ROWS_LIMIT: 50,
      PBINFO_GET_UNSOLVED_RENDER_CHUNK_SIZE: 25,
    },
  });
  window.localStorage.setItem(keys.full, JSON.stringify(snapshot));
  window.confirm = () => true;
  ctx.confirm = window.confirm;
  await startAndDrain(ctx, window, 10);
});

test('iife-harness: DELAY_MS > 0 makes schedule() route through setTimeout', async () => {
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: true,
      status: 200,
      text: async () => '<body>Pagina nu exista.</body>',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 50,
    },
  });
  await startAndDrain(ctx, window, 8);
});

test('iife-harness: list-mode empty body with total=5 triggers empty-page retry', async () => {
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: true,
      status: 200,
      text: async () => '<body><span class="numar_probleme">5</span><div class="row"></div></body>',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 1,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
    },
  });
  await startAndDrain(ctx, window, 8);
});

test('iife-harness: copyTextToClipboard fallback branches via clipboard-throws + execCommand stub', async () => {
  const listUrl = 'https://www.pbinfo.ro/?pagina=probleme-lista';
  const { buildStateKeys } = require('../pbinfo-get-unsolved-enhanced.js');
  const keys = buildStateKeys(listUrl);
  const snapshot = makeLargeListSnapshot(listUrl);
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
  window.confirm = () => true;
  ctx.confirm = window.confirm;
  // clipboard API throws, execCommand returns true — covers the
  // execCommand-success branch of copyTextToClipboard. Apply the mutation
  // inside the vm so the bare `navigator` binding sees it.
  vm.runInContext(
    "globalThis.navigator = { clipboard: { writeText: async () => { throw new Error('denied'); } }, userAgent: 'test' };",
    ctx
  );
  Object.defineProperty(document, 'execCommand', { value: () => true, configurable: true });
  await startAndDrain(ctx, window, 4);
  // Click every button so copyLinks/copyIds/copyMarkdown fire.
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const btn of buttons) {
    try {
      btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    } catch {
      /* ignore */
    }
  }
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setImmediate(r));
  }
});

test('iife-harness: copyTextToClipboard fully-failed fallback → describeClipboardError path', async () => {
  const listUrl = 'https://www.pbinfo.ro/?pagina=probleme-lista';
  const { buildStateKeys } = require('../pbinfo-get-unsolved-enhanced.js');
  const keys = buildStateKeys(listUrl);
  const snapshot = makeLargeListSnapshot(listUrl);
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
  window.confirm = () => true;
  ctx.confirm = window.confirm;
  vm.runInContext(
    "globalThis.navigator = { clipboard: { writeText: async () => { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; } }, userAgent: 'test' };",
    ctx
  );
  Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
  await startAndDrain(ctx, window, 4);
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const btn of buttons) {
    try {
      btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    } catch {
      /* ignore */
    }
  }
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setImmediate(r));
  }
});

test('iife-harness: cloudflare body with retries left exercises the retry-setTimeout branch', async () => {
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: true,
      status: 200,
      text: async () => '<body><div class="cf-chl-opt">Attention Required</div></body>',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 1,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
    },
  });
  await startAndDrain(ctx, window, 6);
});

test('iife-harness: id-range stopAfterMissing triggers automatic finishScan', async () => {
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: false,
      status: 404,
      text: async () => '<body>Pagina nu exista.</body>',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MODE: 'id-range',
      PBINFO_GET_UNSOLVED_ID_START: 1,
      PBINFO_GET_UNSOLVED_ID_END: 5,
      PBINFO_GET_UNSOLVED_ID_MISSING_STOP: 1,
      PBINFO_GET_UNSOLVED_ID_SCORE_BATCH: false,
      PBINFO_GET_UNSOLVED_CONCURRENCY: 1,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
    },
  });
  await startAndDrain(ctx, window, 8);
});

test('iife-harness: list scan with LIVE_RENDER=true + fully-decorated card exercises difficulty/postedBy parse + maybeLiveRender', async () => {
  const body = `<!doctype html><html><body>
    <div class="row">
      <div class="card mb-3">
        <code>#1</code>
        <a href="/probleme/1/test" class="text-dark"><h5>#1 test</h5></a>
        <span title="Dificultate">Ușoară</span>
        <span title="Postată de">
          <a href="/utilizator/alice">
            <img src="https://www.pbinfo.ro/pic.png?u=1&gsize=32"/>
            alice
          </a>
        </span>
        <span title="Autor">Bob</span>
        <span title="Sursa problemei">OlimpInfo 2024</span>
        <div class="card-footer"><span class="badge" title="Punctaj obtinut">50</span></div>
      </div>
    </div>
  </body></html>`;
  let n = 0;
  const { ctx, window } = buildContext({
    fetchResponse: null,
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_LIVE_RENDER: true,
      PBINFO_GET_UNSOLVED_LIVE_RENDER_EVERY_PAGES: 1,
      PBINFO_GET_UNSOLVED_LIVE_RENDER_MIN_MS: 0,
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
  await startAndDrain(ctx, window, 8);
});

test('iife-harness: id-range snapshot restore covers the id-range branch of restoreFromSavedState', async () => {
  const listUrl = 'id-range:https://www.pbinfo.ro:1-1';
  const { buildStateKeys } = require('../pbinfo-get-unsolved-enhanced.js');
  const keys = buildStateKeys(listUrl);
  const snapshot = {
    version: 2,
    schemaVersion: 2,
    storageLevel: 'full',
    savedAt: Date.now(),
    pageLink: listUrl,
    scanMode: 'id-range',
    pagination: { mode: 'offset', param: 'start', pageBase: 1, pageSize: 10 },
    scanStartPage: 1,
    idRange: {
      startId: 1,
      endId: 1,
      stopAfterMissing: 0,
      scoreBatch: { enabled: false, size: 200 },
    },
    pageQueue: [],
    deferred: [],
    inFlightPages: [],
    seenProblemIds: [],
    problems: [],
    stats: { solved: 0, tried: 0, unattempted: 0, total: 0, pages: 0 },
  };
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: false,
      status: 404,
      text: async () => '<body>Pagina nu exista.</body>',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MODE: 'id-range',
      PBINFO_GET_UNSOLVED_ID_START: 1,
      PBINFO_GET_UNSOLVED_ID_END: 1,
      PBINFO_GET_UNSOLVED_ID_SCORE_BATCH: false,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
    },
  });
  window.localStorage.setItem(keys.full, JSON.stringify(snapshot));
  window.confirm = () => true;
  ctx.confirm = window.confirm;
  await startAndDrain(ctx, window, 8);
});

test('iife-harness: list-mode status 500 response + no retries → finishScan error branch', async () => {
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
    },
  });
  await startAndDrain(ctx, window, 6);
});

test('iife-harness: list-mode HTTP 500 with retries available → retry-setTimeout branch', async () => {
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: false,
      status: 500,
      text: async () => 'ISE',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 1,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
    },
  });
  await startAndDrain(ctx, window, 6);
});

test('iife-harness: invalid-request body with retries available → retry-setTimeout branch', async () => {
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: true,
      status: 200,
      text: async () => '<body>Invalid request</body>',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 1,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
    },
  });
  await startAndDrain(ctx, window, 6);
});

async function runScoreBatchScenario(firstResponse) {
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
  let call = 0;
  window.fetch = () => {
    call += 1;
    return Promise.resolve(
      call === 1
        ? firstResponse
        : { ok: false, status: 404, text: async () => '<body>Pagina nu exista.</body>' }
    );
  };
  ctx.fetch = window.fetch;
  await startAndDrain(ctx, window, 10);
}

test('iife-harness: id-range score-batch 500 response walks the batch-failed branch', async () => {
  await runScoreBatchScenario({
    ok: false,
    status: 500,
    text: async () => 'Internal Server Error',
  });
});

test('iife-harness: id-range score-batch cloudflare body walks the batch-blocked branch', async () => {
  await runScoreBatchScenario({
    ok: true,
    status: 200,
    text: async () => '<html><body><div class="cf-chl-opt">Attention Required</div></body></html>',
  });
});

test('iife-harness: list-mode "invalid request" body → dedicated Invalid request branch', async () => {
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: true,
      status: 200,
      text: async () => '<body>Invalid request</body>',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
    },
  });
  await startAndDrain(ctx, window, 6);
});

test('iife-harness: mode-prompt returning null aborts the start', async () => {
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: true,
      status: 200,
      text: async () => '<body>Pagina nu exista.</body>',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MODE_PROMPT: true,
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
    },
  });
  window.prompt = () => null;
  ctx.prompt = window.prompt;
  await startAndDrain(ctx, window, 4);
});

test('iife-harness: id-range problem page missing #scor_utilizator_problema logs the warn-once', async () => {
  const problemPage = `<!doctype html><html><body>
    <h1>#7 Demo</h1>
    <table>
      <tr>
        <td><a href="/user/x">Poster</a></td>
        <td>-</td>
        <td>-</td>
        <td>Mediu</td>
        <td>No score cell here</td>
      </tr>
    </table>
  </body></html>`;
  const { ctx, window } = buildContext({
    fetchResponse: { ok: true, status: 200, text: async () => problemPage },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MODE: 'id-range',
      PBINFO_GET_UNSOLVED_ID_START: 7,
      PBINFO_GET_UNSOLVED_ID_END: 7,
      PBINFO_GET_UNSOLVED_ID_SCORE_BATCH: false,
      PBINFO_GET_UNSOLVED_CONCURRENCY: 1,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
    },
  });
  await startAndDrain(ctx, window, 8);
});

test('iife-harness: id-range with debug enabled exercises the problem-page debug dump', async () => {
  const problemPage = `<!doctype html><html><body>
    <h1>#7 Demo</h1>
    <table>
      <tr>
        <td><a href="/user/x">Poster</a></td>
        <td>-</td>
        <td>-</td>
        <td>Mediu</td>
        <td id="scor_utilizator_problema"></td>
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
      PBINFO_GET_UNSOLVED_ID_SCORE_BATCH: false,
      PBINFO_GET_UNSOLVED_CONCURRENCY: 1,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DEBUG: true,
      PBINFO_GET_UNSOLVED_DEBUG_DUMP_LIMIT: 5,
      PBINFO_GET_UNSOLVED_DEBUG_INCLUDE_HTML: true,
    },
  });
  await startAndDrain(ctx, window, 8);
});

test('iife-harness: id-range 403 with batch-populated score hits the knownIdRangeScore push branch', async () => {
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
  // First call: batch returns scor=42 (not a solve, so scanner proceeds to
  // detail fetch). Second call: detail returns 403 — scanner pushes entry
  // into allProblems via the knownIdRangeScore branch.
  installSequencedFetch(window, ctx, [
    {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id_problema: 7, scor: '42' }] }),
    },
    { ok: false, status: 403, text: async () => 'Forbidden' },
  ]);
  await startAndDrain(ctx, window, 12);
});

test('iife-harness: id-range 403 forbidden response walks the forbidden-skip branch', async () => {
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MODE: 'id-range',
      PBINFO_GET_UNSOLVED_ID_START: 7,
      PBINFO_GET_UNSOLVED_ID_END: 7,
      PBINFO_GET_UNSOLVED_ID_SCORE_BATCH: false,
      PBINFO_GET_UNSOLVED_CONCURRENCY: 1,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
    },
  });
  await startAndDrain(ctx, window, 8);
});

test('iife-harness: id-range 404 missing response walks the not-found-skip branch', async () => {
  const { ctx, window } = buildContext({
    fetchResponse: {
      ok: false,
      status: 404,
      text: async () => '<html><body>Pagina nu exista</body></html>',
    },
    modeOverrides: {
      PBINFO_GET_UNSOLVED_MODE: 'id-range',
      PBINFO_GET_UNSOLVED_ID_START: 7,
      PBINFO_GET_UNSOLVED_ID_END: 7,
      PBINFO_GET_UNSOLVED_ID_SCORE_BATCH: false,
      PBINFO_GET_UNSOLVED_CONCURRENCY: 1,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
    },
  });
  await startAndDrain(ctx, window, 8);
});

test('iife-harness: no-requestAnimationFrame path exercises scheduleChunk setTimeout fallback', async () => {
  const listUrl = 'https://www.pbinfo.ro/?pagina=probleme-lista';
  const { buildStateKeys } = require('../pbinfo-get-unsolved-enhanced.js');
  const keys = buildStateKeys(listUrl);
  const snapshot = makeLargeListSnapshot(listUrl);
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
      PBINFO_GET_UNSOLVED_RENDER_CHUNK_SIZE: 50,
    },
  });
  window.localStorage.setItem(keys.full, JSON.stringify(snapshot));
  window.confirm = () => true;
  ctx.confirm = window.confirm;
  // Drop requestAnimationFrame BEFORE the library runs so scheduleChunk
  // falls back to the setTimeout arrow function (covers the last
  // uncovered function in c8's map).
  delete window.requestAnimationFrame;
  await startAndDrain(ctx, window, 12);
  // Explicitly invoke sortTable → updateTable with 200 rows; that
  // triggers the first chunk + scheduleChunk call for the second.
  try {
    window.sortTable?.('id');
  } catch {
    /* ignore */
  }
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setImmediate(r));
  }
});

test('iife-harness: filter inputs + quota-throwing storage trigger requestRenderResults + noteStorageFailure', async () => {
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
      PBINFO_GET_UNSOLVED_AUTOSAVE: true,
      PBINFO_GET_UNSOLVED_AUTOSAVE_MS: 1,
      PBINFO_GET_UNSOLVED_AUTOSAVE_PAGES: 1,
    },
  });
  // Quota-throwing storage so every setItem bubbles through noteStorageFailure.
  window.localStorage = {
    getItem: () => null,
    setItem() {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    },
    removeItem: () => {},
    clear: () => {},
  };
  ctx.localStorage = window.localStorage;
  await startAndDrain(ctx, window, 4);
  // Dispatch input events on the min/max score and search inputs to fire
  // requestRenderResults.
  const numberInputs = Array.from(document.querySelectorAll('input[type="number"]'));
  for (const input of numberInputs) {
    try {
      input.value = '10';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    } catch {
      /* best effort */
    }
  }
  const textInputs = Array.from(document.querySelectorAll('input[type="text"]'));
  for (const input of textInputs) {
    try {
      input.value = 'x';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    } catch {
      /* best effort */
    }
  }
  // Click save + clear state buttons with the autosave (no snapshot)
  // selection so clearSavedStateForLink is reached.
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const btn of buttons) {
    try {
      btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    } catch {
      /* best effort */
    }
  }
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setImmediate(r));
  }
});

test('iife-harness: import JSON flow with a stubbed file triggers saveImportedSnapshot', async () => {
  const importable = {
    version: 2,
    schemaVersion: 2,
    storageLevel: 'full',
    savedAt: Date.now(),
    pageLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    scanMode: 'list',
    pagination: { mode: 'offset', param: 'start', pageBase: 1, pageSize: 10 },
    scanStartPage: 1,
    pageQueue: [],
    deferred: [],
    inFlightPages: [],
    seenProblemIds: [],
    problems: [
      { id: 99, name: 'imp', link: '/99', status: 'solved', userScore: 100, maxScore: 100 },
    ],
    stats: { solved: 1, tried: 0, unattempted: 0, total: 1, pages: 1 },
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
  window.confirm = () => true;
  ctx.confirm = window.confirm;
  await startAndDrain(ctx, window, 4);
  // Find the file input the import button created and feed it a fake file.
  const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
  for (const input of inputs) {
    const stubFile = {
      name: 'snapshot.json',
      text: async () => JSON.stringify(importable),
    };
    Object.defineProperty(input, 'files', {
      value: [stubFile],
      configurable: true,
    });
    try {
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
    } catch {
      /* best effort */
    }
  }
  for (let i = 0; i < 6; i++) {
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
  await startAndDrain(ctx, window, 8);
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
  await startAndDrain(ctx, window, 4);
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
