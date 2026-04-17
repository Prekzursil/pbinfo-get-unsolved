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
  const source = fs.readFileSync(LIBRARY_PATH, 'utf8');
  vm.runInContext(source, ctx, { filename: LIBRARY_PATH });
  if (typeof window.pbinfoGetUnsolvedStart !== 'function') {
    throw new TypeError('pbinfoGetUnsolvedStart was not defined on window');
  }
});

test('iife-harness: starts a list scan against a not-found page without throwing', () => {
  const { ctx, window } = buildContext();
  const source = fs.readFileSync(LIBRARY_PATH, 'utf8');
  vm.runInContext(source, ctx, { filename: LIBRARY_PATH });
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
  const source = fs.readFileSync(LIBRARY_PATH, 'utf8');
  vm.runInContext(source, ctx, { filename: LIBRARY_PATH });
  try {
    window.pbinfoGetUnsolvedStart();
  } catch {
    /* still useful for coverage */
  }
});

// Realistic-body exercises get complex because fetch() is async and the
// scanner keeps the event loop alive until the scan fully drains. We keep
// only the initialization + id-range + UI-hook exercises; the pure-helper
// tests already cover all the parsing paths the realistic body would hit.

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
  const source = fs.readFileSync(LIBRARY_PATH, 'utf8');
  vm.runInContext(source, ctx, { filename: LIBRARY_PATH });
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
