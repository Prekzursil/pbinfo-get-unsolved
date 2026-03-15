const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');

const {
  createParsedCacheEntry,
  isParsedCacheEntryFresh,
  createNavigationState,
  pickNextNavigationProblem,
  buildResultsExportPayload,
  extractScoreInfoFromProblemPage,
  migrateStateSnapshotToV2,
} = require('../src/core');

function getDocument(html) {
  return parseHTML(html).document;
}

test('helper tail: cache helpers cover explicit matching branches', () => {
  const entry = createParsedCacheEntry({
    schemaVersion: 7,
    cacheKind: ' verify-problem ',
    cacheKey: 42,
    userNamespace: 'user-1',
    value: { ok: true },
    now: 500,
    ttlMs: 5_000,
  });

  assert.equal(entry.schemaVersion, 7);
  assert.equal(entry.cacheKind, 'verify-problem');
  assert.equal(entry.cacheKey, '42');
  assert.equal(
    isParsedCacheEntryFresh(entry, {
      now: 1_000,
      cacheKind: 'verify-problem',
      cacheKey: '42',
      userNamespace: 'user-1',
    }),
    true
  );
  assert.equal(
    isParsedCacheEntryFresh(entry, {
      now: 1_000,
      cacheKind: 'verify-problem',
      cacheKey: 'other',
      userNamespace: 'user-1',
    }),
    false
  );
});

test('helper tail: navigation falls back to link identity for unsolved candidates', () => {
  const navState = createNavigationState();
  const problems = [
    { status: 'tried', link: 'https://www.pbinfo.ro/probleme/11/alpha' },
    { status: 'unattempted', link: 'https://www.pbinfo.ro/probleme/12/beta' },
  ];

  const first = pickNextNavigationProblem(navState, {
    scope: 'weird',
    visibleProblems: problems,
    allProblems: [],
  });
  const second = pickNextNavigationProblem(navState, {
    scope: 'visible',
    visibleProblems: problems,
    allProblems: [],
  });

  assert.equal(first.link, 'https://www.pbinfo.ro/probleme/11/alpha');
  assert.equal(second.link, 'https://www.pbinfo.ro/probleme/12/beta');
});

test('helper tail: results export and snapshot normalization cover non-array fallbacks', () => {
  const payload = buildResultsExportPayload({ not: 'an array' }, { source: { tag: 1 } });
  const migrated = migrateStateSnapshotToV2({
    savedAt: 123,
    pageQueue: [],
    deferred: [],
    inFlightPages: [],
    seenProblemIds: [],
    problems: [],
  });

  assert.deepEqual(payload.problems, []);
  assert.deepEqual(payload.source, { tag: 1 });
  assert.equal(migrated.savedAt, 123);
});

test('helper tail: problem page parsing covers explicit max-score branch', () => {
  const document = getDocument(`
    <table>
      <tr>
        <td id="scor_utilizator_problema"><span title="Punctaj utilizator">42 / 100</span></td>
      </tr>
    </table>
  `);
  const scoreInfo = extractScoreInfoFromProblemPage(document);

  assert.equal(scoreInfo.userScore, 42);
  assert.equal(scoreInfo.maxScore, 100);
});
