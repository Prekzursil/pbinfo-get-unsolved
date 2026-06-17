const test = require('node:test');
const assert = require('node:assert/strict');

const { parseHTML } = require('linkedom');

const {
  extractProblemMetaFromProblemPage,
  extractScoreInfoFromProblemPage,
  normalizeListUrl,
  buildPageUrl,
  migrateStateSnapshotToV2,
  extractSnapshotFromImport,
  serializeProblemForSnapshot,
  computeResumeFromStateSnapshot,
  classifyProblemStatus,
  parseScoreText,
} = require('../pbinfo-get-unsolved-enhanced.js');

function parseDocument(html) {
  const { document } = parseHTML(html);
  return document;
}

// ── extractProblemMetaFromProblemPage: og:title / <title> fallback (lines 220-224) ──
test('meta: falls back to og:title when no heading is present', () => {
  const doc = parseDocument(`<!doctype html><html><head>
      <meta property="og:title" content="Suma cifrelor - pbinfo.ro problema">
      <title>ignored when og:title present</title>
    </head><body><table><tr>
      <td id="scor_utilizator_problema">42</td>
    </tr></table></body></html>`);
  const meta = extractProblemMetaFromProblemPage(doc, 7);
  assert.equal(meta.name, 'Suma cifrelor');
});

test('meta: falls back to <title> when og:title absent and no heading', () => {
  const doc = parseDocument(`<!doctype html><html><head>
      <title>Numere prime - pbinfo.ro</title>
    </head><body></body></html>`);
  const meta = extractProblemMetaFromProblemPage(doc, null);
  assert.equal(meta.name, 'Numere prime');
});

test('meta: empty title/og:title leaves name empty', () => {
  const doc = parseDocument(`<!doctype html><html><head>
      <meta property="og:title" content="   ">
      <title>   </title>
    </head><body></body></html>`);
  const meta = extractProblemMetaFromProblemPage(doc, null);
  assert.equal(meta.name, '');
});

// ── difficulty classification branches (lines 234-237: uso/med/dific/conc) ──
function problemPageWithDifficulty(difficultyText) {
  // Layout: postedBy td (0), source (1), author (2), difficulty (3), score (4).
  return `<!doctype html><html><head><title>p - pbinfo.ro</title></head><body>
    <table><tr>
      <td><a href="https://www.pbinfo.ro/utilizator/1/x">X</a></td>
      <td>Surse</td>
      <td>Autorul</td>
      <td>${difficultyText}</td>
      <td id="scor_utilizator_problema"><span>30 / 100</span></td>
    </tr></table></body></html>`;
}

test('meta: difficulty "ușor" -> 0', () => {
  const doc = parseDocument(problemPageWithDifficulty('ușor'));
  assert.equal(extractProblemMetaFromProblemPage(doc, 1).difficulty, 0);
});

test('meta: difficulty "mediu" -> 1', () => {
  const doc = parseDocument(problemPageWithDifficulty('mediu'));
  assert.equal(extractProblemMetaFromProblemPage(doc, 1).difficulty, 1);
});

test('meta: difficulty "dificil" -> 2', () => {
  const doc = parseDocument(problemPageWithDifficulty('dificil'));
  assert.equal(extractProblemMetaFromProblemPage(doc, 1).difficulty, 2);
});

test('meta: difficulty "concurs" -> 3', () => {
  const doc = parseDocument(problemPageWithDifficulty('concurs'));
  assert.equal(extractProblemMetaFromProblemPage(doc, 1).difficulty, 3);
});

test('meta: unknown difficulty text keeps default 3', () => {
  const doc = parseDocument(problemPageWithDifficulty('necunoscut'));
  assert.equal(extractProblemMetaFromProblemPage(doc, 1).difficulty, 3);
});

test('meta: author/source dashes are normalized to empty strings', () => {
  const doc = parseDocument(`<!doctype html><html><head><title>p - pbinfo.ro</title></head><body>
    <table><tr>
      <td><a href="https://www.pbinfo.ro/utilizator/1/x">X<img src="https://e/a.png"></a></td>
      <td>-</td>
      <td>-</td>
      <td>mediu</td>
      <td id="scor_utilizator_problema"><span>30 / 100</span></td>
    </tr></table></body></html>`);
  const meta = extractProblemMetaFromProblemPage(doc, 1);
  assert.equal(meta.author, '');
  assert.equal(meta.source, '');
  assert.equal(meta.postedBy_name, 'X');
  assert.equal(meta.postedBy_img, 'https://e/a.png');
});

// ── extractScoreInfoFromProblemPage: tooltip-only score path ──
test('score (problem page): tooltip provides the score when text has none', () => {
  const doc = parseDocument(`<!doctype html><html><body>
    <td id="scor_utilizator_problema"><a class="badge" title="Punctaj: 75 / 100">vezi</a></td>
    </body></html>`);
  const info = extractScoreInfoFromProblemPage(doc);
  assert.equal(info.userScore, 75);
  assert.equal(info.maxScore, 100);
  assert.equal(classifyProblemStatus(info), 'tried');
});

// ── normalizeListUrl: malformed URL -> null (lines 298-302) ──
test('normalizeListUrl: malformed input with no base returns null', () => {
  assert.equal(normalizeListUrl('http://[bad', '', 'start'), null);
});

test('normalizeListUrl: both empty returns null', () => {
  assert.equal(normalizeListUrl('', '', 'start'), null);
});

// ── buildPageUrl: null baseUrl ──
test('buildPageUrl: missing baseUrl returns null', () => {
  assert.equal(buildPageUrl('', { pageIndex: 1, pageSize: 10 }), null);
});

// ── migrateStateSnapshotToV2: storageLevel inference (line 382 minimal branch) ──
test('migrate: problems array without explicit storageLevel infers "minimal"', () => {
  const out = migrateStateSnapshotToV2({
    problems: [{ id: 1, name: 'a' }],
  });
  assert.equal(out.storageLevel, 'minimal');
  assert.equal(out.version, 2);
  assert.equal(out.schemaVersion, 2);
});

test('migrate: no problems array infers "progress" storageLevel', () => {
  const out = migrateStateSnapshotToV2({ savedAt: 123 });
  assert.equal(out.storageLevel, 'progress');
  assert.equal(out.savedAt, 123);
  assert.deepEqual(out.problems, []);
});

test('migrate: explicit full storageLevel is preserved and queues coerced', () => {
  const out = migrateStateSnapshotToV2({
    storageLevel: 'full',
    pageQueue: ['3', 'x', 4.9],
    deferred: [['2', '1'], { pageIndex: 5, retryCount: 0 }, ['bad', 'x']],
    inFlightPages: ['7', 'no'],
    seenProblemIds: ['9', 'nope'],
    stats: { solved: 2 },
    resumeFromPage: 2,
  });
  assert.equal(out.storageLevel, 'full');
  assert.deepEqual(out.pageQueue, [3, 4]);
  assert.deepEqual(out.deferred, [
    [2, 1],
    [5, 0],
  ]);
  assert.deepEqual(out.inFlightPages, [7]);
  assert.deepEqual(out.seenProblemIds, [9]);
  assert.equal(out.stats.solved, 2);
  assert.equal(out.stats.tried, 0);
  assert.equal(out.resumeFromPage, 2);
});

test('migrate: missing resumeFromPage is computed from outstanding pages', () => {
  const out = migrateStateSnapshotToV2({
    storageLevel: 'progress',
    pageQueue: [8, 9],
    deferred: [[3, 1]],
  });
  assert.equal(out.resumeFromPage, 3);
});

test('migrate: rejects non-object input', () => {
  assert.equal(migrateStateSnapshotToV2(null), null);
  assert.equal(migrateStateSnapshotToV2('nope'), null);
});

// ── extractSnapshotFromImport: wrapped vs raw payload (lines 439-442) ──
test('import: wrapped snapshot payload is migrated', () => {
  const out = extractSnapshotFromImport({
    type: 'pbinfo-get-unsolved-snapshot',
    state: { problems: [{ id: 1 }] },
  });
  assert.equal(out.version, 2);
  assert.equal(out.storageLevel, 'minimal');
});

test('import: raw (non-wrapped) payload is migrated directly', () => {
  const out = extractSnapshotFromImport({ savedAt: 5 });
  assert.equal(out.version, 2);
  assert.equal(out.savedAt, 5);
});

test('import: invalid payload returns null', () => {
  assert.equal(extractSnapshotFromImport(null), null);
  assert.equal(extractSnapshotFromImport(42), null);
});

// ── serializeProblemForSnapshot: minimal level branch (line 530) ──
test('serialize: minimal level omits extended metadata fields', () => {
  const minimal = serializeProblemForSnapshot(
    {
      id: 7,
      name: 'n',
      link: 'l',
      difficulty: 2,
      status: 'solved',
      userScore: 100,
      maxScore: 100,
      author: 'A',
      source: 'S',
    },
    'minimal'
  );
  assert.deepEqual(minimal, {
    id: 7,
    name: 'n',
    link: 'l',
    difficulty: 2,
    status: 'solved',
    userScore: 100,
    maxScore: 100,
  });
  assert.ok(!('author' in minimal));
  assert.ok(!('source' in minimal));
});

test('serialize: non-finite scores are coerced to null', () => {
  const minimal = serializeProblemForSnapshot(
    { id: 1, userScore: 'x', maxScore: undefined },
    'minimal'
  );
  assert.equal(minimal.userScore, null);
  assert.equal(minimal.maxScore, null);
});

// ── computeResumeFromStateSnapshot: nextSequentialPage-only path ──
test('resume: nextSequentialPage is considered when queues are empty', () => {
  assert.equal(computeResumeFromStateSnapshot({ nextSequentialPage: 5 }), 5);
});

test('resume: deferred object-form entries are read', () => {
  assert.equal(computeResumeFromStateSnapshot({ deferred: [{ pageIndex: 4 }] }), 4);
});

// ── parseScoreText: bare-number-only and no-number paths ──
test('parseScoreText: bare number yields null max', () => {
  assert.deepEqual(parseScoreText('abc 17 xyz'), { value: 17, max: null, hasRatio: false });
});

test('parseScoreText: no digits returns null', () => {
  assert.equal(parseScoreText('no score here'), null);
});

test('parseScoreText: empty/whitespace returns null', () => {
  assert.equal(parseScoreText('   '), null);
});
