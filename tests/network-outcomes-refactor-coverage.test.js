const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');

const {
  createOutcomeLedger,
  recordOutcomeEntry,
  summarizeOutcomeLedger,
  parseRetryAfterMs,
  normalizeListUrl,
  detectPbinfoUserNamespace,
} = require('../src/core');

test('network coverage tail: normalizeListUrl and parseRetryAfterMs cover invalid-input branches', () => {
  assert.equal(normalizeListUrl('https://[::1', '', 'start'), null);

  const hugeSeconds = '9'.repeat(400);
  assert.equal(parseRetryAfterMs(hugeSeconds, Number.NaN), null);
});

test('network coverage tail: detectPbinfoUserNamespace ignores anchors without usable hrefs', () => {
  const { document } = parseHTML(`
    <html>
      <body>
        <header>
          <a>Missing href</a>
        </header>
        <nav>
          <a href="https://www.pbinfo.ro/utilizator/5/good-user">Good user</a>
        </nav>
      </body>
    </html>
  `);

  assert.equal(detectPbinfoUserNamespace(document), '5:good-user');
});

test('outcomes coverage tail: whitespace and nullish values normalize to unknown defaults', () => {
  const ledger = createOutcomeLedger();
  const unknown = recordOutcomeEntry(ledger, {
    targetType: '   ',
    targetKey: '   ',
    status: null,
  });

  assert.equal(unknown.key, 'unknown:?');
  assert.equal(unknown.targetType, 'unknown');
  assert.equal(unknown.targetKey, '?');
  assert.equal(unknown.status, 'unknown');

  const summary = summarizeOutcomeLedger(ledger);
  assert.equal(summary.unknown, 1);
  assert.equal(summary.avgDurationMs, 0);
});

test('outcomes coverage tail: summary tolerates null seeded entries', () => {
  const summary = summarizeOutcomeLedger({ entries: { broken: null } });

  assert.equal(summary.total, 1);
  assert.equal(summary.unknown, 1);
  assert.equal(summary.unknowns, 1);
  assert.equal(summary.avgDurationMs, 0);
});
