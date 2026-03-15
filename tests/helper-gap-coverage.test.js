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

test('helper gap coverage: cache helpers reject mismatched identity branches', () => {
  const created = createParsedCacheEntry({
    now: 100,
    ttlMs: 50,
    schemaVersion: Number.NaN,
    cacheKind: '',
    cacheKey: '',
    userNamespace: '  ',
    value: { ok: true },
  });

  assert.deepEqual(created, {
    schemaVersion: 1,
    cacheKind: 'unknown',
    cacheKey: '?',
    userNamespace: null,
    cachedAt: 100,
    expiresAt: 150,
    value: { ok: true },
  });
  assert.equal(
    isParsedCacheEntryFresh(created, {
      now: 120,
      cacheKind: 'score-batch',
    }),
    false
  );
  assert.equal(
    isParsedCacheEntryFresh(
      {
        ...created,
        cacheKind: 'score-batch',
        cacheKey: 'batch:1',
        userNamespace: '12:tester',
      },
      {
        now: 120,
        cacheKind: 'score-batch',
        cacheKey: 'batch:2',
        userNamespace: '12:tester',
      }
    ),
    false
  );
});

test('helper gap coverage: cache helpers reject namespace and invalid expiration branches', () => {
  const created = createParsedCacheEntry({
    now: 100,
    ttlMs: 50,
    schemaVersion: Number.NaN,
    cacheKind: '',
    cacheKey: '',
    userNamespace: '  ',
    value: { ok: true },
  });

  assert.equal(
    isParsedCacheEntryFresh(
      {
        ...created,
        cacheKind: 'score-batch',
        cacheKey: 'batch:1',
        userNamespace: '12:tester',
      },
      {
        now: 120,
        cacheKind: 'score-batch',
        cacheKey: 'batch:1',
        userNamespace: '',
      }
    ),
    false
  );
  assert.equal(
    isParsedCacheEntryFresh(
      {
        ...created,
        cacheKind: 'score-batch',
        cacheKey: 'batch:1',
        userNamespace: null,
        expiresAt: Number.NaN,
      },
      {
        now: 120,
        cacheKind: 'score-batch',
        cacheKey: 'batch:1',
        userNamespace: '',
      }
    ),
    false
  );
});

test('helper gap coverage: navigation signatures fall back to links and invalid options stay harmless', () => {
  const navState = createNavigationState();
  const linkOnlyProblems = [
    { link: 'https://www.pbinfo.ro/problema/10', status: 'tried' },
    { link: 'https://www.pbinfo.ro/problema/20', status: 'unattempted' },
  ];

  assert.equal(pickNextNavigationProblem(navState, null), null);
  assert.equal(
    pickNextNavigationProblem(navState, {
      scope: 'visible',
      visibleProblems: linkOnlyProblems,
      allProblems: [],
    }).link,
    'https://www.pbinfo.ro/problema/10'
  );
  assert.equal(
    navState.signatures.visible,
    linkOnlyProblems.map((problem) => problem.link).join(',')
  );
});

test('helper gap coverage: export payload tolerates non-array problems and invalid meta sections', () => {
  const payload = buildResultsExportPayload(
    { not: 'an array' },
    {
      source: 'bad',
      settings: null,
      coverage: 42,
      reliability: ['bad'],
      verification: { verified: 1 },
    }
  );

  assert.equal(payload.type, 'pbinfo-get-unsolved-results');
  assert.deepEqual(payload.source, {});
  assert.deepEqual(payload.settings, {});
  assert.deepEqual(payload.coverage, {});
  assert.deepEqual(payload.reliability, { 0: 'bad' });
  assert.deepEqual(payload.verification, { verified: 1 });
  assert.deepEqual(payload.problems, []);
});

test('helper gap coverage: problem-page score extraction keeps maxScore null for plain points', () => {
  const { document } = parseHTML(`
    <table>
      <tr>
        <td id="scor_utilizator_problema"><span>25p</span></td>
      </tr>
    </table>
  `);

  assert.deepEqual(extractScoreInfoFromProblemPage(document), {
    userScore: 25,
    maxScore: null,
    candidates: [
      {
        el: document.querySelector('#scor_utilizator_problema span'),
        tooltip: '',
        text: '25p',
        value: 25,
        max: null,
        hasRatio: false,
      },
    ],
  });
});

test('helper gap coverage: snapshot migration falls back to Date.now for invalid savedAt', () => {
  const originalNow = Date.now;
  const fixedNow = Number.parseInt('987654321', 10);
  Date.now = () => fixedNow;

  try {
    const migrated = migrateStateSnapshotToV2({
      savedAt: 'not-a-number',
      problems: 'invalid',
      pageQueue: ['3'],
      deferred: [{ pageIndex: '4', retryCount: '1' }],
      inFlightPages: ['5'],
      seenProblemIds: ['6'],
      stats: null,
    });

    assert.equal(migrated.savedAt, fixedNow);
    assert.deepEqual(migrated.problems, []);
    assert.deepEqual(migrated.pageQueue, [3]);
    assert.deepEqual(migrated.deferred, [[4, 1]]);
    assert.deepEqual(migrated.inFlightPages, [5]);
    assert.deepEqual(migrated.seenProblemIds, [6]);
  } finally {
    Date.now = originalNow;
  }
});
