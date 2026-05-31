'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildContext, boot } = require('./helpers/iife-harness.cjs');

const PROBLEM_SCORE_42 = fs.readFileSync(
  path.resolve(__dirname, 'fixtures', 'problem-page-score-42.html'),
  'utf8'
);
const TERMINATOR = '<body>Pagina nu exista.</body>';
const PAGE_LINK = 'https://www.pbinfo.ro/?pagina=probleme-lista&clasa=1';

function fnv1a32(str) {
  const s = String(str || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function stateKey(pageLink) {
  return `pbinfo-get-unsolved:state:v2:${fnv1a32(pageLink)}`;
}

function resp(text, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

function fullSnapshot() {
  return {
    version: 2,
    schemaVersion: 2,
    storageLevel: 'full',
    savedAt: Date.now() - 1000,
    scanMode: 'list',
    idRange: null,
    pageLink: PAGE_LINK,
    pagination: { mode: 'offset', param: 'start', pageBase: 1 },
    scanStartPage: 1,
    pageSize: 2,
    totalProblems: 4,
    totalPages: 2,
    elapsedMs: 1000,
    stats: { solved: 1, tried: 1, unattempted: 0, total: 2, pages: 1, missing: 0, forbidden: 0 },
    filters: {
      statuses: ['tried', 'unattempted'],
      includeUnknownScore: true,
      scoreMin: 0,
      scoreMax: 99,
      searchQuery: '',
    },
    sorted: {},
    queueInitialized: true,
    pageQueue: [2],
    deferred: [],
    nextSequentialPage: 2,
    inFlightPages: [],
    paused: false,
    stopRequested: false,
    end: null,
    reason: null,
    resumeFromPage: 2,
    problems: [
      {
        cnt: 1,
        id: 101,
        name: 'Suma',
        link: 'https://www.pbinfo.ro/probleme/101/suma',
        difficulty: 0,
        score: 100,
        scoreKnown: true,
        userScore: 100,
        maxScore: 100,
        status: 'solved',
        postedBy_link: '',
        postedBy_name: '',
        postedBy_img: '',
        author: '',
        source: '',
      },
      {
        cnt: 2,
        id: 102,
        name: 'Diferenta',
        link: 'https://www.pbinfo.ro/probleme/102/diferenta',
        difficulty: 1,
        score: 40,
        scoreKnown: true,
        userScore: 40,
        maxScore: 100,
        status: 'tried',
        postedBy_link: '',
        postedBy_name: '',
        postedBy_img: '',
        author: '',
        source: '',
      },
    ],
    seenProblemIds: [101, 102],
  };
}

test('restore: saved full state is loaded when user confirms', async () => {
  const snap = fullSnapshot();
  const harness = buildContext({
    promptResponses: [PAGE_LINK, '1'],
    confirmResponse: true,
    localStorageSeed: { [stateKey(PAGE_LINK)]: JSON.stringify(snap) },
    windowOverrides: {
      PBINFO_GET_UNSOLVED_MODE_PROMPT: false,
      PBINFO_GET_UNSOLVED_MODE: 'list',
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_MAX_PAGES: 0,
    },
    fetchResponse: resp(TERMINATOR),
  });
  await boot(harness, 20);
  assert.ok(harness.confirmCalls.length >= 1, 'confirm should be asked about restore');
});

test('restore: saved state declined keeps fresh scan', async () => {
  const snap = fullSnapshot();
  const harness = buildContext({
    promptResponses: [PAGE_LINK, '1'],
    confirmResponse: false,
    localStorageSeed: { [stateKey(PAGE_LINK)]: JSON.stringify(snap) },
    windowOverrides: {
      PBINFO_GET_UNSOLVED_MODE_PROMPT: false,
      PBINFO_GET_UNSOLVED_MODE: 'list',
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
    },
    fetchResponse: resp(TERMINATOR),
  });
  await boot(harness, 16);
  assert.ok(harness.confirmCalls.length >= 1);
});

test('id-range: score batch endpoint returns json and feeds prefetch cache', async () => {
  const batchJson = JSON.stringify({
    data: [
      { id_problema: '1', scor: '100' },
      { id_problema: '2', scor: '42' },
      { id_problema: '3', scor: '-' },
    ],
  });
  const harness = buildContext({
    promptResponses: ['1-3', '1'],
    windowOverrides: {
      PBINFO_GET_UNSOLVED_MODE_PROMPT: false,
      PBINFO_GET_UNSOLVED_MODE: 'id-range',
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_ID_SCORE_BATCH: true,
      PBINFO_GET_UNSOLVED_ID_SCORE_BATCH_SIZE: 200,
    },
    fetchResponse: (url) => {
      if (String(url).includes('json-probleme-scor')) return resp(batchJson);
      return resp(PROBLEM_SCORE_42);
    },
  });
  await boot(harness, 30);
  const batchHit = harness.fetchCalls.some((c) => String(c.url).includes('json-probleme-scor'));
  assert.ok(batchHit, 'score batch endpoint should be fetched');
});

test('id-range: score batch http error falls back gracefully', async () => {
  const harness = buildContext({
    promptResponses: ['1-2', '1'],
    windowOverrides: {
      PBINFO_GET_UNSOLVED_MODE_PROMPT: false,
      PBINFO_GET_UNSOLVED_MODE: 'id-range',
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_ID_SCORE_BATCH: true,
    },
    fetchResponse: (url) => {
      if (String(url).includes('json-probleme-scor')) return resp('err', 500);
      return resp(PROBLEM_SCORE_42);
    },
  });
  await boot(harness, 30);
  assert.ok(harness.fetchCalls.length >= 1);
});
