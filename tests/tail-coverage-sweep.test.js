const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');

const {
  createParsedCacheEntry,
  isParsedCacheEntryFresh,
  computeBackoffWithJitter,
  createNavigationState,
  pickNextNavigationProblem,
  pickRandomNavigationProblem,
  formatDuration,
  buildProgressText,
  problemsToCsv,
  problemsToLinksText,
  problemsToIdsText,
  problemsToMarkdownText,
  buildResultsExportPayload,
  applyVerifiedScoreToProblem,
  serializeProblemForSnapshot,
  restoreProblemsFromSnapshot,
  extractSnapshotFromImport,
  migrateStateSnapshotToV2,
  extractScoreInfoFromProblemPage,
} = require('../src/core');

function getDocument(html) {
  return parseHTML(html).document;
}

function createProgressInput(overrides = {}) {
  return {
    scanMode: 'list',
    now: 2_000,
    startedAt: 1_000,
    config: {},
    paused: false,
    inFlight: 0,
    stats: {},
    totalPages: null,
    totalProblems: null,
    pageSize: null,
    adaptiveEnabled: false,
    effectiveDelayMs: 0,
    effectiveConcurrency: 1,
    ...overrides,
  };
}

test('tail coverage: cache and navigation helpers hit the last fallback branches', () => {
  const entry = createParsedCacheEntry({
    schemaVersion: Number.NaN,
    cacheKind: '',
    cacheKey: '',
    userNamespace: '',
    now: 1_000,
    ttlMs: 5_000,
  });

  assert.equal(entry.schemaVersion, 1);
  assert.equal(entry.cacheKind, 'unknown');
  assert.equal(
    isParsedCacheEntryFresh(entry, {
      now: 2_000,
      cacheKind: '',
      cacheKey: '',
      userNamespace: null,
    }),
    true
  );
  assert.equal(
    pickNextNavigationProblem(createNavigationState(), {
      scope: 'visible',
      visibleProblems: [null, { status: 'tried', link: '  https://www.pbinfo.ro/probleme/9/x  ' }],
      allProblems: [],
    }).link,
    '  https://www.pbinfo.ro/probleme/9/x  '
  );
});

test('tail coverage: export, snapshot, and score helpers preserve final fallback behavior', () => {
  const scoreDocument = getDocument(`
    <table>
      <tr>
        <td>poster</td>
        <td>sursa</td>
        <td>autor</td>
        <td>medie</td>
        <td id="scor_utilizator_problema"><span title="Punctaj utilizator">42p</span></td>
      </tr>
    </table>
  `);
  const payload = buildResultsExportPayload(undefined, {});
  const migrated = migrateStateSnapshotToV2({
    savedAt: 123,
    problems: [],
  });
  const scoreInfo = extractScoreInfoFromProblemPage(scoreDocument);

  assert.deepEqual(payload.problems, []);
  assert.equal(migrated.savedAt, 123);
  assert.equal(scoreInfo.maxScore, null);
});

test('tail coverage: navigation helper initialization and empty scopes stay deterministic', () => {
  const partialNavState = {};
  const emptyResult = pickNextNavigationProblem(partialNavState, {
    scope: 'visible',
    visibleProblems: [],
    allProblems: [],
  });
  const nextByLink = pickNextNavigationProblem(partialNavState, {
    scope: 'all',
    visibleProblems: [],
    allProblems: [{ link: 'https://www.pbinfo.ro/probleme/1/demo', status: 'tried' }],
  });
  const randomEmpty = pickRandomNavigationProblem(createNavigationState(), {
    scope: 'visible',
    visibleProblems: [],
    allProblems: [],
  });

  assert.equal(emptyResult, null);
  assert.equal(nextByLink.link, 'https://www.pbinfo.ro/probleme/1/demo');
  assert.equal(randomEmpty, null);
  assert.deepEqual(
    Object.keys(partialNavState.signatures).sort((left, right) => left.localeCompare(right)),
    ['all', 'visible']
  );

  assert.throws(() => {
    pickNextNavigationProblem(null, {
      scope: 'visible',
      visibleProblems: [{ id: 1, status: 'tried' }],
      allProblems: [],
    });
  });
});

test('tail coverage: navigation random branches behave with crypto available', () => {
  const cryptoBefore = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues(target) {
        target[0] = 0x40000000;
        return target;
      },
    },
  });
  try {
    assert.equal(
      pickRandomNavigationProblem(
        {
          signatures: { visible: 'https://www.pbinfo.ro/probleme/2/demo', all: '' },
          cursors: { visible: -1, all: -1 },
          randomBags: { visible: [undefined], all: [] },
        },
        {
          scope: 'visible',
          visibleProblems: [{ link: 'https://www.pbinfo.ro/probleme/2/demo', status: 'tried' }],
          allProblems: [],
          rng: () => Number.NaN,
        }
      ),
      null
    );
    assert.equal(
      pickRandomNavigationProblem(createNavigationState(), {
        scope: 'visible',
        visibleProblems: [
          { link: 'https://www.pbinfo.ro/probleme/2/demo', status: 'tried' },
          { link: 'https://www.pbinfo.ro/probleme/5/demo', status: 'unattempted' },
        ],
        allProblems: [],
      }).link,
      'https://www.pbinfo.ro/probleme/5/demo'
    );

    assert.equal(computeBackoffWithJitter(0, { baseMs: 100, capMs: 250 }), 25);
  } finally {
    if (cryptoBefore) {
      Object.defineProperty(globalThis, 'crypto', cryptoBefore);
    } else {
      delete globalThis.crypto;
    }
  }
});

test('tail coverage: navigation random branches handle missing crypto', () => {
  const cryptoAfter = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  delete globalThis.crypto;
  try {
    assert.equal(computeBackoffWithJitter(0, { baseMs: 100, capMs: 250 }), 0);
    assert.equal(
      pickRandomNavigationProblem(createNavigationState(), {
        scope: 'visible',
        visibleProblems: [
          { link: 'https://www.pbinfo.ro/probleme/3/demo', status: 'tried' },
          { link: 'https://www.pbinfo.ro/probleme/4/demo', status: 'unattempted' },
        ],
        allProblems: [],
      }).link,
      'https://www.pbinfo.ro/probleme/4/demo'
    );
  } finally {
    if (cryptoAfter) {
      Object.defineProperty(globalThis, 'crypto', cryptoAfter);
    }
  }
});

test('tail coverage: cache and navigation helpers accept default namespace and all scope', () => {
  const entry = createParsedCacheEntry({
    cacheKind: 'score-batch',
    cacheKey: '1-10',
    ttlMs: 5,
    now: 10,
  });
  const navState = createNavigationState();

  assert.equal(isParsedCacheEntryFresh(entry, { now: 12 }), true);
  assert.equal(
    pickNextNavigationProblem(navState, {
      scope: 'all',
      visibleProblems: null,
      allProblems: [
        { id: 1, status: 'solved' },
        { link: 'https://www.pbinfo.ro/problema/2', status: 'tried' },
      ],
    }).link,
    'https://www.pbinfo.ro/problema/2'
  );
  assert.equal(
    pickRandomNavigationProblem(navState, {
      scope: 'invalid',
      visibleProblems: [{ link: 'https://www.pbinfo.ro/problema/3', status: 'unattempted' }],
      allProblems: [],
      rng: () => Number.NaN,
    }).link,
    'https://www.pbinfo.ro/problema/3'
  );
});

test('tail coverage: progress helpers keep fallback formatting and eta behavior', () => {
  const idRangeProgress = buildProgressText(
    createProgressInput({
      scanMode: 'id-range',
      config: { startPage: 5, idRange: {} },
      stats: { pages: 0, total: 0, missing: 0, forbidden: 0 },
    })
  );
  const stalledProgress = buildProgressText(
    createProgressInput({
      now: 1_000,
      stats: { pages: 1, total: 1 },
      totalPages: 5,
      totalProblems: 10,
      pageSize: 10,
    })
  );

  assert.equal(formatDuration(3_661_000), '1h 01m 01s');
  assert.equal(formatDuration(999), '0s');
  assert.equal(buildProgressText(createProgressInput()), 'Progres: pagini 0, probleme 0 · timp 1s');
  assert.match(idRangeProgress, /^Progres: ID-uri 0, probleme 0 \(găsite\) · timp 1s \(de la 5\)$/);
  assert.doesNotMatch(stalledProgress, /ETA/);
  assert.equal(buildProgressText(), 'Progres: pagini 0, probleme 0 · timp 0s');
});

test('tail coverage: export and verification helpers keep fallback output contracts', () => {
  assert.match(problemsToCsv([{ id: 1, name: 'a,"b"\n', link: 'x' }]), /"a,""b""/);
  assert.equal(problemsToCsv(null).startsWith('\ufeffid,name,status'), true);
  assert.equal(
    problemsToLinksText([{}, { link: ' https://www.pbinfo.ro/ ' }]),
    'https://www.pbinfo.ro/'
  );
  assert.equal(problemsToIdsText([{ id: Number.NaN }, { id: 4 }]), '4');
  assert.equal(problemsToMarkdownText([{ id: 1, name: 'No link' }]), '');
  assert.equal(
    problemsToMarkdownText([{ name: 'Doar nume', link: 'https://www.pbinfo.ro/probleme/99/demo' }]),
    '- [Doar nume](<https://www.pbinfo.ro/probleme/99/demo>)'
  );
  assert.equal(problemsToLinksText(null), '');
  assert.equal(problemsToIdsText(null), '');
  assert.equal(problemsToMarkdownText(null), '');

  const payload = buildResultsExportPayload([{}], null);
  assert.deepEqual(payload.source, {});
  assert.deepEqual(payload.settings, {});
  assert.equal(payload.problems[0].status, 'unattempted');
  assert.equal(payload.problems[0].quality, 'scan-only');

  const verified = applyVerifiedScoreToProblem(
    { status: 'weird', maxScore: 80 },
    { userScore: 79, maxScore: null }
  );
  assert.equal(verified.previousStatus, 'unattempted');
  assert.equal(verified.problem.maxScore, 80);
  assert.equal(verified.problem.status, 'tried');
  assert.equal(
    applyVerifiedScoreToProblem(null, { userScore: 100, maxScore: 100 }).problem.status,
    'solved'
  );
});

test('tail coverage: snapshot helpers preserve migration and import fallbacks', () => {
  assert.deepEqual(serializeProblemForSnapshot({ id: 1, quality: 'verified' }, 'minimal'), {
    id: 1,
    name: undefined,
    link: undefined,
    difficulty: undefined,
    status: undefined,
    quality: 'verified',
    verifiedAt: null,
    userScore: null,
    maxScore: null,
  });

  assert.equal(migrateStateSnapshotToV2(null), null);
  const migrated = migrateStateSnapshotToV2({
    storageLevel: 'broken',
    savedAt: 'bad',
    pageQueue: ['3', 'bad'],
    deferred: [{ pageIndex: 'bad', retryCount: 2 }, ['5', '1']],
    inFlightPages: ['7'],
    seenProblemIds: ['10', 'oops'],
    stats: {},
  });

  assert.equal(migrated.storageLevel, 'progress');
  assert.deepEqual(migrated.pageQueue, [3]);
  assert.deepEqual(migrated.deferred, [[5, 1]]);
  assert.deepEqual(migrated.inFlightPages, [7]);
  assert.deepEqual(migrated.seenProblemIds, [10]);
  assert.equal(migrated.stats.pages, 0);
  assert.deepEqual(migrateStateSnapshotToV2({ problems: [{}] }).problems, [{}]);

  const directImport = extractSnapshotFromImport({ version: 1, pageQueue: [2] });
  assert.equal(directImport.version, 2);
  assert.equal(extractSnapshotFromImport({ foo: 'bar' }), null);

  const restored = restoreProblemsFromSnapshot({
    problems: [{ id: 'bad' }, { id: 1, postedBy_link: 1 }],
    seenProblemIds: ['bad'],
  });
  assert.equal(restored.allProblems[0].postedBy_link, '');
  assert.equal(restored.seenProblemIds.has(1), true);
});
