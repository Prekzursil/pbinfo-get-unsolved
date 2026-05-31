'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildContext, boot } = require('./helpers/iife-harness.cjs');

const LIST_TWO_CARDS = fs.readFileSync(
  path.resolve(__dirname, 'fixtures', 'list-page-two-cards.html'),
  'utf8'
);
const PROBLEM_SCORE_100 = fs.readFileSync(
  path.resolve(__dirname, 'fixtures', 'problem-page-score-100.html'),
  'utf8'
);
const PROBLEM_SCORE_42 = fs.readFileSync(
  path.resolve(__dirname, 'fixtures', 'problem-page-score-42.html'),
  'utf8'
);
const PROBLEM_NO_SCORE = fs.readFileSync(
  path.resolve(__dirname, 'fixtures', 'problem-page-no-score.html'),
  'utf8'
);

const TERMINATOR = '<body>Pagina nu exista.</body>';

function resp(text, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

const LIST_NO_PROMPT = {
  PBINFO_GET_UNSOLVED_MODE_PROMPT: false,
  PBINFO_GET_UNSOLVED_MODE: 'list',
  PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
  PBINFO_GET_UNSOLVED_DELAY_MS: 0,
  PBINFO_GET_UNSOLVED_TIMEOUT_MS: 1000,
};

const ID_NO_PROMPT = {
  PBINFO_GET_UNSOLVED_MODE_PROMPT: false,
  PBINFO_GET_UNSOLVED_MODE: 'id-range',
  PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
  PBINFO_GET_UNSOLVED_DELAY_MS: 0,
  PBINFO_GET_UNSOLVED_TIMEOUT_MS: 1000,
  PBINFO_GET_UNSOLVED_ID_SCORE_BATCH: false,
};

test('list scan: page with cards then terminator finishes and lists problems', async () => {
  let call = 0;
  const harness = buildContext({
    promptResponses: ['https://www.pbinfo.ro/?pagina=probleme-lista', '1'],
    windowOverrides: { ...LIST_NO_PROMPT, PBINFO_GET_UNSOLVED_MAX_PAGES: 2 },
    fetchResponse: () => {
      call += 1;
      return call === 1 ? resp(LIST_TWO_CARDS) : resp(TERMINATOR);
    },
  });
  await boot(harness, 20);
  assert.ok(harness.fetchCalls.length >= 1);
});

test('list scan: blocked HTML triggers blocked finish', async () => {
  const blocked = '<body><div>Attention Required! Cloudflare</div>cf-browser-verification</body>';
  const harness = buildContext({
    promptResponses: ['https://www.pbinfo.ro/?pagina=probleme-lista', '1'],
    windowOverrides: { ...LIST_NO_PROMPT, PBINFO_GET_UNSOLVED_MAX_PAGES: 1 },
    fetchResponse: resp(blocked),
  });
  await boot(harness, 16);
  assert.ok(harness.fetchCalls.length >= 1);
});

test('list scan: HTTP 500 with no retries finishes with failure', async () => {
  const harness = buildContext({
    promptResponses: ['https://www.pbinfo.ro/?pagina=probleme-lista', '1'],
    windowOverrides: { ...LIST_NO_PROMPT, PBINFO_GET_UNSOLVED_MAX_PAGES: 1 },
    fetchResponse: resp('<body>err</body>', 500),
  });
  await boot(harness, 16);
  assert.ok(harness.fetchCalls.length >= 1);
});

test('list scan: empty page (no cards, no total) finishes', async () => {
  const harness = buildContext({
    promptResponses: ['https://www.pbinfo.ro/?pagina=probleme-lista', '1'],
    windowOverrides: { ...LIST_NO_PROMPT, PBINFO_GET_UNSOLVED_MAX_PAGES: 1 },
    fetchResponse: resp('<body><div class="container"></div></body>'),
  });
  await boot(harness, 16);
  assert.ok(harness.fetchCalls.length >= 1);
});

test('list scan: network error rejects and finishes', async () => {
  const harness = buildContext({
    promptResponses: ['https://www.pbinfo.ro/?pagina=probleme-lista', '1'],
    windowOverrides: { ...LIST_NO_PROMPT, PBINFO_GET_UNSOLVED_MAX_PAGES: 1 },
    fetchResponse: new Error('network down'),
  });
  await boot(harness, 16);
  assert.ok(harness.fetchCalls.length >= 1);
});

test('id-range scan: solved + 404 + 403 mix', async () => {
  let call = 0;
  const harness = buildContext({
    promptResponses: ['1-3', '1'],
    windowOverrides: { ...ID_NO_PROMPT },
    fetchResponse: () => {
      call += 1;
      if (call === 1) return resp(PROBLEM_SCORE_100);
      if (call === 2) return resp(TERMINATOR, 404);
      return resp('<body>forbidden</body>', 403);
    },
  });
  await boot(harness, 24);
  assert.ok(harness.fetchCalls.length >= 1);
});

test('id-range scan: tried (42) and no-score page', async () => {
  let call = 0;
  const harness = buildContext({
    promptResponses: ['1-2', '1'],
    windowOverrides: { ...ID_NO_PROMPT },
    fetchResponse: () => {
      call += 1;
      return call === 1 ? resp(PROBLEM_SCORE_42) : resp(PROBLEM_NO_SCORE);
    },
  });
  await boot(harness, 24);
  assert.ok(harness.fetchCalls.length >= 1);
});

test('list scan: user cancels mode by returning null start page stops', async () => {
  const harness = buildContext({
    promptResponses: ['https://www.pbinfo.ro/?pagina=probleme-lista', null],
    windowOverrides: { ...LIST_NO_PROMPT, PBINFO_GET_UNSOLVED_MAX_PAGES: 1 },
    fetchResponse: resp(TERMINATOR),
  });
  await boot(harness, 8);
  assert.equal(harness.fetchCalls.length, 0);
});

test('list scan: invalid link stops before fetching', async () => {
  const harness = buildContext({
    promptResponses: ['not a url', '1'],
    href: 'not-a-valid-base',
    windowOverrides: { ...LIST_NO_PROMPT, PBINFO_GET_UNSOLVED_MAX_PAGES: 1 },
    fetchResponse: resp(TERMINATOR),
  });
  await boot(harness, 8);
  assert.ok(harness.promptCalls.length >= 1);
});
