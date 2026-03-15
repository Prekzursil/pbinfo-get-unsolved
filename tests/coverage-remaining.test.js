const test = require('node:test');
const assert = require('node:assert/strict');

const { parseHTML } = require('linkedom');

const {
  createParsedCacheEntry,
  isParsedCacheEntryFresh,
  createNavigationState,
  pickNextNavigationProblem,
  pickRandomNavigationProblem,
  problemsToMarkdownText,
  buildResultsExportPayload,
  normalizeScanMode,
  applyThemePreference,
  selectScoreFromCandidates,
  extractScoreInfoFromProblemPage,
  extractProblemMetaFromProblemPage,
  stripProblemIdPrefix,
  serializeProblemForSnapshot,
  computeResumeFromStateSnapshot,
  migrateStateSnapshotToV2,
  extractSnapshotFromImport,
} = require('../src/core');

function getDocument(html) {
  return parseHTML(html).document;
}

test('coverage remaining: cache entry normalization branches', () => {
  const defaultEntry = createParsedCacheEntry();
  const explicitEntry = createParsedCacheEntry({
    schemaVersion: 2,
    cacheKind: 'verify-problem',
    cacheKey: 42,
    userNamespace: 'demo-user',
    now: 100,
    ttlMs: 500,
  });

  assert.equal(defaultEntry.schemaVersion, 1);
  assert.equal(defaultEntry.cacheKind, 'unknown');
  assert.equal(defaultEntry.cacheKey, '?');
  assert.equal(defaultEntry.userNamespace, null);
  assert.equal(explicitEntry.schemaVersion, 2);
  assert.equal(explicitEntry.cacheKind, 'verify-problem');
  assert.equal(explicitEntry.cacheKey, '42');
  assert.equal(explicitEntry.userNamespace, 'demo-user');
});

test('coverage remaining: cache freshness fallback branches', () => {
  const defaultEntry = createParsedCacheEntry();
  const explicitEntry = createParsedCacheEntry({
    schemaVersion: 2,
    cacheKind: 'verify-problem',
    cacheKey: 42,
    userNamespace: 'demo-user',
    now: 100,
    ttlMs: 500,
  });

  assert.equal(isParsedCacheEntryFresh(null, null), false);
  assert.equal(
    isParsedCacheEntryFresh(explicitEntry, {
      now: 200,
      cacheKind: 'verify-problem',
      cacheKey: '42',
      userNamespace: 'demo-user',
    }),
    true
  );
  assert.equal(
    isParsedCacheEntryFresh(defaultEntry, {
      now: defaultEntry.cachedAt,
      cacheKind: 'different-kind',
    }),
    false
  );
  assert.equal(
    isParsedCacheEntryFresh(
      createParsedCacheEntry({
        cacheKind: 'verify',
        cacheKey: '42',
        userNamespace: '',
        now: 100,
        ttlMs: 1_000,
      }),
      { now: 200, cacheKey: 'other' }
    ),
    false
  );
});

test('coverage remaining: navigation helpers cover fallback branches', () => {
  const navState = createNavigationState();
  assert.equal(pickNextNavigationProblem(navState, null), null);
  assert.equal(pickRandomNavigationProblem(navState, null), null);

  const visibleProblems = [
    { status: 'solved', id: 1, link: 'https://www.pbinfo.ro/probleme/1/a' },
    { status: 'tried', link: ' https://www.pbinfo.ro/probleme/2/b ' },
  ];
  const nextProblem = pickNextNavigationProblem(navState, {
    scope: 'visible',
    visibleProblems,
    allProblems: null,
  });
  assert.equal(nextProblem.link.trim(), 'https://www.pbinfo.ro/probleme/2/b');

  const randomProblem = pickRandomNavigationProblem(navState, {
    scope: 'all',
    visibleProblems: [],
    allProblems: [{ status: 'tried', link: 'https://www.pbinfo.ro/probleme/3/c' }],
    rng() {
      return 2;
    },
  });
  assert.equal(randomProblem.link, 'https://www.pbinfo.ro/probleme/3/c');
  assert.equal(
    pickNextNavigationProblem(createNavigationState(), {
      scope: 'visible',
      visibleProblems: [{ status: 'tried' }],
      allProblems: [],
    }).status,
    'tried'
  );
});

test('coverage remaining: export and setup helpers preserve fallback output', () => {
  const previousLocalStorage = globalThis.localStorage;
  const fallbackTarget = {
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };

  delete globalThis.localStorage;
  try {
    assert.equal(normalizeScanMode(null), null);
    assert.equal(applyThemePreference('mystery', null, { fallbackTarget }), 'system');
  } finally {
    if (previousLocalStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = previousLocalStorage;
    }
  }

  assert.equal(
    problemsToMarkdownText([
      { id: 5, name: '', link: '' },
      { id: 6, name: '', link: 'https://www.pbinfo.ro/probleme/6/demo' },
    ]),
    '- [#6](<https://www.pbinfo.ro/probleme/6/demo>)'
  );

  const payload = buildResultsExportPayload([null], null);
  const emptyPayload = buildResultsExportPayload(null, null);
  assert.deepEqual(payload.source, {});
  assert.deepEqual(payload.settings, {});
  assert.equal(payload.problems.length, 1);
  assert.equal(payload.problems[0].status, 'unattempted');
  assert.equal(payload.problems[0].quality, 'scan-only');
  assert.deepEqual(emptyPayload.problems, []);
});

test('coverage remaining: score parsing helpers cover object and fallback paths', () => {
  const scoreDocument = getDocument(`
    <table>
      <tr>
        <td><a>poster</a></td>
        <td>sursa</td>
        <td>autor</td>
        <td>medie</td>
        <td id="scor_utilizator_problema"><span title="Punctaj utilizator">42p</span></td>
      </tr>
    </table>
  `);
  const ratioScoreDocument = getDocument(`
    <table>
      <tr>
        <td><a>poster</a></td>
        <td>sursa</td>
        <td>autor</td>
        <td>medie</td>
        <td id="scor_utilizator_problema"><span>10 / 100</span></td>
      </tr>
    </table>
  `);

  assert.deepEqual(selectScoreFromCandidates(null), { userScore: null, maxScore: null });
  assert.deepEqual(
    selectScoreFromCandidates([
      {
        tooltip: 'maxim bonus',
        text: '50p',
        value: 50,
        max: null,
        hasRatio: false,
        isLink: false,
      },
    ]),
    { userScore: 50, maxScore: null }
  );

  const scoreInfo = extractScoreInfoFromProblemPage(scoreDocument);
  assert.equal(scoreInfo.userScore, 42);
  assert.equal(scoreInfo.maxScore, null);
  assert.equal(extractScoreInfoFromProblemPage(ratioScoreDocument).maxScore, 100);
});

test('coverage remaining: problem meta extraction fallback paths', () => {
  const anchorWithoutImageDocument = getDocument(`
    <table>
      <tr>
        <td><a>poster simplu</a></td>
        <td>-</td>
        <td>-</td>
        <td>medie</td>
        <td id="scor_utilizator_problema"><span>10 / 100</span></td>
      </tr>
    </table>
  `);
  const meta = extractProblemMetaFromProblemPage(anchorWithoutImageDocument, null);
  assert.equal(meta.postedBy_name, 'poster simplu');
  assert.equal(meta.postedBy_img, '');
  assert.equal(meta.author, '');
  assert.equal(meta.source, '');
});

test('coverage remaining: snapshot helpers cover object and fallback paths', () => {
  assert.equal(stripProblemIdPrefix('#123', 123), '');
  assert.deepEqual(serializeProblemForSnapshot({ id: 9, quality: 'verified' }, 'minimal'), {
    id: 9,
    name: undefined,
    link: undefined,
    difficulty: undefined,
    status: undefined,
    quality: 'verified',
    verifiedAt: null,
    userScore: null,
    maxScore: null,
  });
  assert.equal(
    computeResumeFromStateSnapshot({
      deferred: [{ pageIndex: 5, retryCount: 2 }],
    }),
    5
  );

  const migrated = migrateStateSnapshotToV2({
    savedAt: 'not-a-number',
    pageQueue: ['7', 'oops'],
    deferred: [
      { pageIndex: '6', retryCount: '2' },
      { pageIndex: 'bad', retryCount: '1' },
    ],
    inFlightPages: ['8'],
    seenProblemIds: ['9'],
    problems: 'not-an-array',
  });
  assert.equal(Array.isArray(migrated.problems), true);
  assert.equal(migrated.problems.length, 0);
  assert.equal(migrated.pageQueue[0], 7);
  assert.deepEqual(migrated.deferred, [[6, 2]]);
  assert.equal(migrated.resumeFromPage, 6);
  assert.equal(Number.isFinite(migrated.savedAt), true);
  assert.equal(migrateStateSnapshotToV2({ savedAt: 123, problems: [] }).savedAt, 123);

  assert.equal(extractSnapshotFromImport(null), null);
});
