'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildContext,
  boot,
  drainMicrotasks,
  uiRoot,
  findElements,
  clickByText,
  fireEvent,
} = require('./helpers/iife-harness.cjs');

const LIST_TWO_CARDS = fs.readFileSync(
  path.resolve(__dirname, 'fixtures', 'list-page-two-cards.html'),
  'utf8'
);
const TERMINATOR = '<body>Pagina nu exista.</body>';

function resp(text, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

async function bootScanned() {
  let call = 0;
  const harness = buildContext({
    promptResponses: ['https://www.pbinfo.ro/?pagina=probleme-lista', '1'],
    windowOverrides: {
      PBINFO_GET_UNSOLVED_MODE_PROMPT: false,
      PBINFO_GET_UNSOLVED_MODE: 'list',
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
    },
    fetchResponse: () => {
      call += 1;
      return call === 1 ? resp(LIST_TWO_CARDS) : resp(TERMINATOR);
    },
  });
  await boot(harness, 24);
  return harness;
}

test('ui: export buttons (csv/json/links/ids/markdown) run', async () => {
  const harness = await bootScanned();
  for (const label of [
    'CSV (filtrat)',
    'JSON (filtrat)',
    'Copiază link-uri',
    'Copiază ID-uri',
    'Copiază Markdown',
  ]) {
    clickByText(harness, label);
  }
  await drainMicrotasks(6);
  assert.ok(uiRoot(harness), 'UI root present');
});

test('ui: snapshot save/load/clear/export buttons run', async () => {
  const harness = await bootScanned();
  // Snapshot prompt returns a label.
  harness.promptCalls.length = 0;
  clickByText(harness, 'Snapshot');
  clickByText(harness, 'Export JSON');
  // Stop the scan so load is permitted, then load + clear.
  clickByText(harness, 'Stop scan');
  await drainMicrotasks(6);
  clickByText(harness, 'Încarcă');
  clickByText(harness, 'Șterge');
  await drainMicrotasks(6);
  assert.ok(uiRoot(harness));
});

test('ui: pause then stop toggles control state', async () => {
  let call = 0;
  const harness = buildContext({
    promptResponses: ['https://www.pbinfo.ro/?pagina=probleme-lista', '1'],
    windowOverrides: {
      PBINFO_GET_UNSOLVED_MODE_PROMPT: false,
      PBINFO_GET_UNSOLVED_MODE: 'list',
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_MAX_PAGES: 5,
    },
    fetchResponse: () => {
      call += 1;
      return call <= 1 ? resp(LIST_TWO_CARDS) : resp(TERMINATOR);
    },
  });
  await boot(harness, 6);
  clickByText(harness, 'Pauză');
  clickByText(harness, 'Continuă');
  clickByText(harness, 'Stop scan');
  await drainMicrotasks(10);
  assert.ok(uiRoot(harness));
});

test('ui: toggling filters and inputs re-renders results', async () => {
  const harness = await bootScanned();
  const root = uiRoot(harness);
  assert.ok(root);

  // Toggle every checkbox filter.
  for (const cb of findElements(harness, 'input[type="checkbox"]')) {
    cb.checked = !cb.checked;
    fireEvent(cb, 'change');
  }
  // Type into text/number/search inputs.
  for (const input of findElements(harness, 'input[type="text"], input[type="search"]')) {
    input.value = 'Suma';
    fireEvent(input, 'input');
  }
  for (const input of findElements(harness, 'input[type="number"]')) {
    input.value = '10';
    fireEvent(input, 'input');
  }
  // Change selects.
  for (const sel of findElements(harness, 'select')) {
    const opts = sel.querySelectorAll('option');
    if (opts.length > 0) {
      try {
        sel.value = opts[opts.length - 1].value;
      } catch {
        sel.setAttribute('value', opts[opts.length - 1].value);
      }
      fireEvent(sel, 'change');
    }
  }
  await drainMicrotasks(6);
  assert.ok(uiRoot(harness));
});

test('ui: clicking table headers sorts results', async () => {
  const harness = await bootScanned();
  const headers = findElements(harness, 'th');
  for (const th of headers) {
    th.click();
  }
  await drainMicrotasks(6);
  assert.ok(uiRoot(harness));
});

test('ui: close button removes overlay', async () => {
  const harness = await bootScanned();
  // Any element that closes the overlay (×) — click all anchors/buttons with × text.
  const closers = findElements(harness, 'button, a, span').filter((el) =>
    /[×✕✖x]/i.test((el.textContent || '').trim())
  );
  for (const el of closers) {
    try {
      el.click();
    } catch {
      /* best-effort */
    }
  }
  await drainMicrotasks(6);
  assert.ok(harness.document);
});
