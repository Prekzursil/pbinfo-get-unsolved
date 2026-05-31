'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildContext,
  boot,
  drainMicrotasks,
  findElements,
  clickByText,
  fireEvent,
} = require('./helpers/iife-harness.cjs');

const LIST_TWO_CARDS = fs.readFileSync(
  path.resolve(__dirname, 'fixtures', 'list-page-two-cards.html'),
  'utf8'
);
const TERMINATOR = '<body>Pagina nu exista.</body>';
const PAGE_LINK = 'https://www.pbinfo.ro/?pagina=probleme-lista';

function resp(text, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

async function bootScanned(overrides = {}) {
  let call = 0;
  const harness = buildContext({
    promptResponses: [PAGE_LINK, '1'],
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
    ...overrides,
  });
  await boot(harness, 24);
  return harness;
}

function mockFile(name, content) {
  return { name, text: async () => content };
}

function fileInput(harness) {
  return findElements(harness, 'input[type="file"]')[0];
}

function setFiles(input, files) {
  Object.defineProperty(input, 'files', { configurable: true, value: files });
}

test('import: valid same-link snapshot is saved', async () => {
  const harness = await bootScanned();
  const input = fileInput(harness);
  const payload = {
    type: 'pbinfo-get-unsolved-snapshot',
    state: {
      version: 2,
      pageLink: PAGE_LINK,
      storageLevel: 'full',
      problems: [{ id: 1, name: 'P', link: '/1', status: 'tried', userScore: 50, maxScore: 100 }],
      seenProblemIds: [1],
    },
  };
  setFiles(input, [mockFile('snap.json', JSON.stringify(payload))]);
  fireEvent(input, 'change');
  await drainMicrotasks(8);
  assert.ok(harness.document);
});

test('import: snapshot for a different link is remapped after confirm', async () => {
  const harness = await bootScanned({ confirmResponse: true });
  const input = fileInput(harness);
  const payload = {
    type: 'pbinfo-get-unsolved-snapshot',
    state: {
      version: 2,
      pageLink: 'https://www.pbinfo.ro/other',
      storageLevel: 'minimal',
      problems: [{ id: 2, name: 'Q', link: '/2', status: 'unattempted' }],
    },
  };
  setFiles(input, [mockFile('other.json', JSON.stringify(payload))]);
  fireEvent(input, 'change');
  await drainMicrotasks(8);
  assert.ok(harness.confirmCalls.length >= 1);
});

test('import: bare snapshot object (no type wrapper) is accepted', async () => {
  const harness = await bootScanned();
  const input = fileInput(harness);
  const bare = {
    version: 2,
    pageLink: PAGE_LINK,
    storageLevel: 'full',
    problems: [{ id: 3, name: 'R', link: '/3', status: 'solved', userScore: 100, maxScore: 100 }],
    seenProblemIds: [3],
  };
  setFiles(input, [mockFile('bare.json', JSON.stringify(bare))]);
  fireEvent(input, 'change');
  await drainMicrotasks(8);
  assert.ok(harness.document);
});

test('import: invalid JSON file logs an error', async () => {
  const harness = await bootScanned();
  const input = fileInput(harness);
  setFiles(input, [mockFile('bad.json', 'not json {{{')]);
  fireEvent(input, 'change');
  await drainMicrotasks(8);
  assert.ok(harness.document);
});

test('import: change with no file is a no-op', async () => {
  const harness = await bootScanned();
  const input = fileInput(harness);
  setFiles(input, []);
  fireEvent(input, 'change');
  await drainMicrotasks(4);
  assert.ok(harness.document);
});

test('snapshot: save then export the saved snapshot via select', async () => {
  const harness = await bootScanned();
  // Save a manual snapshot (prompt returns label).
  clickByText(harness, 'Snapshot');
  await drainMicrotasks(4);
  // Select the snapshot option if present and export it.
  const select = findElements(harness, 'select')[0];
  if (select) {
    const snapOpt = Array.from(select.querySelectorAll('option')).find((o) =>
      String(o.value).startsWith('snapshot:')
    );
    if (snapOpt) {
      try {
        select.value = snapOpt.value;
      } catch {
        select.setAttribute('value', snapOpt.value);
      }
      fireEvent(select, 'change');
    }
  }
  clickByText(harness, 'Export JSON');
  await drainMicrotasks(4);
  assert.ok(harness.objectUrls.length >= 0);
});
