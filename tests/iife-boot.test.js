'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContext, boot } = require('./helpers/iife-harness.cjs');

test('iife boot: list mode scans one page and renders UI root', async () => {
  const harness = buildContext({
    promptResponses: ['https://www.pbinfo.ro/?pagina=probleme-lista&clasa=1', '1'],
    windowOverrides: {
      PBINFO_GET_UNSOLVED_MODE_PROMPT: false,
      PBINFO_GET_UNSOLVED_MODE: 'list',
      PBINFO_GET_UNSOLVED_MAX_PAGES: 1,
      PBINFO_GET_UNSOLVED_MAX_RETRIES: 0,
      PBINFO_GET_UNSOLVED_DELAY_MS: 0,
      PBINFO_GET_UNSOLVED_TIMEOUT_MS: 1000,
    },
    fetchResponse: {
      ok: true,
      status: 200,
      text: async () => '<body>Pagina nu exista.</body>',
    },
  });

  await boot(harness);

  assert.ok(harness.fetchCalls.length >= 1, 'expected at least one fetch');
});
