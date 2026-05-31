'use strict';

// Shared harness that boots the browser IIFE (`runPbinfoGetUnsolved`) from
// pbinfo-get-unsolved-enhanced.js inside a linkedom-backed DOM with stubbed
// fetch / localStorage / prompt / timers, so the browser-only runtime
// executes under Node and is observable by coverage.
//
// The library is our own pinned source (never attacker input); it is loaded
// into a fresh vm context per harness so each scenario is isolated.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

const LIBRARY_PATH = path.resolve(__dirname, '..', '..', 'pbinfo-get-unsolved-enhanced.js');
const LIBRARY_SOURCE = fs.readFileSync(LIBRARY_PATH, 'utf8');

const DEFAULT_LIST_HTML = '<!doctype html><html><head></head><body></body></html>';

function makeLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    _store: store,
  };
}

// A localStorage whose setItem always throws a quota error — used to drive
// the storage-failure branches.
function makeQuotaLocalStorage() {
  const ls = makeLocalStorage();
  ls.setItem = () => {
    const err = new Error('quota');
    err.name = 'QuotaExceededError';
    throw err;
  };
  return ls;
}

function buildContext(options = {}) {
  const {
    html = DEFAULT_LIST_HTML,
    href = 'https://www.pbinfo.ro/?pagina=probleme-lista&clasa=1',
    promptResponses = [],
    confirmResponse = true,
    fetchImpl = null,
    fetchResponse = null,
    localStorageSeed = {},
    quotaStorage = false,
    windowOverrides = {},
    clipboard = { writeText: async () => {} },
  } = options;

  const { window, document } = parseHTML(html);

  // The IIFE restores console via a hidden iframe's contentWindow. linkedom
  // does not implement frame browsing contexts, so wrap createElement to give
  // iframes a contentWindow whose console proxies to a no-op console.
  const noopConsole = {
    log() {},
    warn() {},
    error() {},
    info() {},
    debug() {},
    clear() {},
  };
  const originalCreateElement = document.createElement.bind(document);
  document.createElement = (tagName, ...rest) => {
    const el = originalCreateElement(tagName, ...rest);
    if (String(tagName).toLowerCase() === 'iframe') {
      Object.defineProperty(el, 'contentWindow', {
        configurable: true,
        get() {
          return { console: noopConsole };
        },
      });
    }
    return el;
  };

  const localStorage = quotaStorage ? makeQuotaLocalStorage() : makeLocalStorage(localStorageSeed);

  const promptQueue = [...promptResponses];
  const promptCalls = [];
  const prompt = (message, fallback) => {
    promptCalls.push({ message, fallback });
    return promptQueue.length > 0 ? promptQueue.shift() : fallback;
  };

  const confirmCalls = [];
  const confirm = (message) => {
    confirmCalls.push(message);
    return typeof confirmResponse === 'function' ? confirmResponse(message) : confirmResponse;
  };

  const fetchCalls = [];
  const fetch = (url, init) => {
    fetchCalls.push({ url, init });
    if (typeof fetchImpl === 'function') {
      return fetchImpl(url, init);
    }
    const resp = typeof fetchResponse === 'function' ? fetchResponse(url, init) : fetchResponse;
    if (resp instanceof Error) {
      return Promise.reject(resp);
    }
    return Promise.resolve(
      resp || {
        ok: true,
        status: 200,
        text: async () => '<body>Pagina nu exista.</body>',
      }
    );
  };

  const navigator = { clipboard, userAgent: 'harness' };

  // URL.createObjectURL / revokeObjectURL are not implemented in Node's URL;
  // provide a thin wrapper so the file-download helper runs under the harness.
  const objectUrls = [];
  function HarnessURL(...args) {
    return new URL(...args);
  }
  HarnessURL.prototype = URL.prototype;
  Object.setPrototypeOf(HarnessURL, URL);
  HarnessURL.createObjectURL = (blob) => {
    const id = `blob:harness/${objectUrls.length}`;
    objectUrls.push({ id, blob });
    return id;
  };
  HarnessURL.revokeObjectURL = () => {};

  let parsedHref = null;
  try {
    parsedHref = new URL(href);
  } catch {
    parsedHref = null;
  }
  const location = {
    href,
    origin: parsedHref ? parsedHref.origin : 'https://www.pbinfo.ro',
    search: parsedHref ? parsedHref.search : '',
  };

  // linkedom's window lacks several browser UI methods the IIFE calls.
  const ensureFn = (target, name, fn) => {
    if (typeof target[name] !== 'function') {
      target[name] = fn;
    }
  };
  ensureFn(window, 'scroll', () => {});
  ensureFn(window, 'scrollTo', () => {});
  ensureFn(window, 'requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0));
  ensureFn(window, 'cancelAnimationFrame', (id) => clearTimeout(id));
  ensureFn(window, 'matchMedia', (query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  ensureFn(window, 'getComputedStyle', () => ({ getPropertyValue: () => '' }));
  ensureFn(window, 'alert', () => {});

  // linkedom's window lacks several browser globals the IIFE reads.
  window.PBINFO_GET_UNSOLVED_NO_AUTORUN = true;
  Object.assign(window, windowOverrides);

  const ctx = {
    window,
    document,
    location,
    navigator,
    localStorage,
    prompt,
    confirm,
    fetch,
    console: {
      log() {},
      warn() {},
      error() {},
      info() {},
      debug() {},
      clear() {},
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    queueMicrotask,
    URL: HarnessURL,
    Blob:
      window.Blob ||
      class Blob {
        constructor(parts) {
          this.parts = parts;
        }
      },
    AbortController,
    // DOM constructors the IIFE references as bare globals are implemented by
    // linkedom on its window object; surface them into the vm context.
    DOMParser: window.DOMParser,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    Document: window.Document,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    NodeList: window.NodeList,
    FileReader: window.FileReader || globalThis.FileReader,
    Math,
    Date,
    JSON,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    Error,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
  };
  ctx.globalThis = ctx;
  ctx.self = ctx;

  vm.createContext(ctx);

  const clipboardWrites = [];
  const originalWriteText = clipboard.writeText;
  clipboard.writeText = (text) => {
    clipboardWrites.push(text);
    return originalWriteText ? originalWriteText(text) : Promise.resolve();
  };

  return {
    ctx,
    window,
    document,
    localStorage,
    promptCalls,
    confirmCalls,
    fetchCalls,
    clipboardWrites,
    objectUrls,
    location,
  };
}

function loadLibrary(harness) {
  vm.runInContext(LIBRARY_SOURCE, harness.ctx, { filename: LIBRARY_PATH }); // NOSONAR pinned own source
}

async function drainMicrotasks(ticks = 12) {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// Boot the IIFE and let async pipelines settle.
async function boot(harness, ticks = 12) {
  loadLibrary(harness);
  try {
    harness.window.pbinfoGetUnsolvedStart();
  } catch {
    /* best-effort: scenario assertions check observable state */
  }
  await drainMicrotasks(ticks);
}

function uiRoot(harness) {
  return harness.document.getElementById('pbinfo-get-unsolved-root');
}

function findElements(harness, selector) {
  const root = uiRoot(harness) || harness.document;
  return Array.from(root.querySelectorAll(selector));
}

function clickByText(harness, text, selector = 'button') {
  const el = findElements(harness, selector).find(
    (node) => (node.textContent || '').trim() === text
  );
  if (el) {
    el.click();
  }
  return el || null;
}

function clickAll(harness, selector) {
  for (const el of findElements(harness, selector)) {
    try {
      el.click();
    } catch {
      /* best-effort */
    }
  }
}

function fireEvent(el, type) {
  if (!el) {
    return;
  }
  const evt = el.ownerDocument.createEvent ? el.ownerDocument.createEvent('Event') : { type };
  if (typeof evt.initEvent === 'function') {
    evt.initEvent(type, true, true);
  } else {
    evt.type = type;
  }
  el.dispatchEvent(evt);
}

module.exports = {
  LIBRARY_PATH,
  LIBRARY_SOURCE,
  buildContext,
  loadLibrary,
  boot,
  drainMicrotasks,
  makeLocalStorage,
  makeQuotaLocalStorage,
  uiRoot,
  findElements,
  clickByText,
  clickAll,
  fireEvent,
};
