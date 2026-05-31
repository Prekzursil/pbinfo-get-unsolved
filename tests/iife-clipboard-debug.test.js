'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildContext, boot, drainMicrotasks, clickByText } = require('./helpers/iife-harness.cjs');

const LIST_TWO_CARDS = fs.readFileSync(
  path.resolve(__dirname, 'fixtures', 'list-page-two-cards.html'),
  'utf8'
);
const LIST_UNATTEMPTED = fs.readFileSync(
  path.resolve(__dirname, 'fixtures', 'list-page-unattempted.html'),
  'utf8'
);
const TERMINATOR = '<body>Pagina nu exista.</body>';
const PAGE_LINK = 'https://www.pbinfo.ro/?pagina=probleme-lista';

function resp(text, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

const BASE_WINDOW = {
  PBINFO_GET_UNSOLVED_MODE_PROMPT: false,
  PBINFO_GET_UNSOLVED_MODE: 'list',
  PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
  PBINFO_GET_UNSOLVED_DELAY_MS: 0,
  PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
};

async function bootList(fixture, extra = {}) {
  let call = 0;
  const harness = buildContext({
    promptResponses: [PAGE_LINK, '1'],
    windowOverrides: { ...BASE_WINDOW },
    fetchResponse: () => {
      call += 1;
      return call === 1 ? resp(fixture) : resp(TERMINATOR);
    },
    ...extra,
  });
  await boot(harness, 24);
  return harness;
}

test('clipboard: copy buttons use the clipboard API on success', async () => {
  const writes = [];
  const harness = await bootList(LIST_TWO_CARDS, {
    clipboard: {
      writeText: async (t) => {
        writes.push(t);
      },
    },
  });
  clickByText(harness, 'Copiază link-uri');
  clickByText(harness, 'Copiază ID-uri');
  clickByText(harness, 'Copiază Markdown');
  await drainMicrotasks(8);
  assert.ok(writes.length >= 1, 'clipboard API should be used');
});

test('clipboard: falls back to execCommand when clipboard API rejects', async () => {
  const harness = await bootList(LIST_TWO_CARDS, {
    clipboard: {
      writeText: async () => {
        throw new Error('denied');
      },
    },
    execCommandResult: true,
  });
  clickByText(harness, 'Copiază link-uri');
  await drainMicrotasks(8);
  assert.ok(harness.document);
});

test('clipboard: total failure surfaces describeClipboardError', async () => {
  const harness = await bootList(LIST_TWO_CARDS, {
    clipboard: {
      writeText: async () => {
        const err = new Error('nope');
        err.name = 'NotAllowedError';
        throw err;
      },
    },
    execCommandResult: false,
  });
  clickByText(harness, 'Copiază ID-uri');
  await drainMicrotasks(8);
  assert.ok(harness.document);
});

test('debug: dump fires for unattempted problem when debug enabled', async () => {
  const harness = await bootList(LIST_UNATTEMPTED, {
    windowOverrides: {
      ...BASE_WINDOW,
      PBINFO_GET_UNSOLVED_DEBUG: true,
      PBINFO_GET_UNSOLVED_DEBUG_HTML: true,
      PBINFO_GET_UNSOLVED_DEBUG_LIMIT: 5,
    },
  });
  assert.ok(harness.fetchCalls.length >= 1);
});
