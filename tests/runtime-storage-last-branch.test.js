const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');

const { showSetupWizard } = require('../src/core');

function createConfig() {
  return {
    startPage: 1,
    concurrency: 1,
    delayMs: 100,
    pagination: { param: 'start' },
    idRange: { startId: 10, endId: 20 },
    cache: { enabled: true, forceRefresh: false },
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

test('runtime storage last branch: wizard tolerates null defaults and still opens', async () => {
  const parsedDom = parseHTML('<html><body></body></html>');
  const document = parsedDom.document;
  const window = parsedDom.window;
  const promise = showSetupWizard({
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    config: createConfig(),
    defaults: null,
    overlayEnabled: true,
    localStorageApi: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    documentRef: document,
    locationRef: { origin: 'https://www.pbinfo.ro' },
    setSelectOptions,
  });

  assert.notEqual(document.querySelector('[data-role="setup-mode"]'), null);
  document.querySelector('[data-role="setup-cancel"]').dispatchEvent(new window.Event('click'));
  assert.equal(await promise, null);
});

async function testRuntimeStorageDefaultsWithoutScanMode() {
  const parsedDom = parseHTML('<html><body></body></html>');
  const document = parsedDom.document;
  const window = parsedDom.window;
  const promise = showSetupWizard({
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    config: createConfig(),
    defaults: {
      idRange: '20-30',
      startPage: 5,
    },
    overlayEnabled: true,
    localStorageApi: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    documentRef: document,
    locationRef: { origin: 'https://www.pbinfo.ro' },
    setSelectOptions,
  });

  assert.ok(document.querySelector('[data-role="setup-mode"]'));
  document.querySelector('[data-role="setup-cancel"]').dispatchEvent(new window.Event('click'));
  assert.equal(await promise, null);
}

test(
  'runtime storage last branch: wizard falls back to list mode when defaults omit scanMode',
  testRuntimeStorageDefaultsWithoutScanMode
);

test('runtime storage last branch: wizard honors explicit id-range defaults during bootstrap', async () => {
  const parsedDom = parseHTML('<html><body></body></html>');
  const document = parsedDom.document;
  const window = parsedDom.window;
  const promise = showSetupWizard({
    defaultLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    config: createConfig(),
    defaults: {
      scanMode: 'id-range',
      idRange: '20-30',
      startPage: 5,
    },
    overlayEnabled: true,
    localStorageApi: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    documentRef: document,
    locationRef: { origin: 'https://www.pbinfo.ro' },
    setSelectOptions,
  });

  assert.equal(document.querySelector('[data-role="setup-range"]').value, '20-30');
  document.querySelector('[data-role="setup-cancel"]').dispatchEvent(new window.Event('click'));
  assert.equal(await promise, null);
});
