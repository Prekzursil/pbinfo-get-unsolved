'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { formatFetchRetryLog } = require('../pbinfo-get-unsolved-enhanced.js');

test('formatFetchRetryLog: timeout path', () => {
  assert.equal(
    formatFetchRetryLog('pagina 3', '0.5s', true),
    'Timeout la pagina 3. Reîncerc în 0.5s...'
  );
});

test('formatFetchRetryLog: network-error path', () => {
  assert.equal(
    formatFetchRetryLog('ID 7', '1.0s', false),
    'Eroare de rețea la ID 7. Reîncerc în 1.0s...'
  );
});
