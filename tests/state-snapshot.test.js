const test = require('node:test');
const assert = require('node:assert/strict');

const {
  serializeProblemForSnapshot,
  restoreProblemFromSnapshotEntry,
  restoreProblemsFromSnapshot,
  computeResumeFromStateSnapshot,
} = require('../src/core');

test('snapshot: computeResumeFromStateSnapshot picks lowest outstanding index', () => {
  assert.equal(
    computeResumeFromStateSnapshot({
      pageQueue: [10, 11],
      deferred: [[12, 1]],
      inFlightPages: [13],
      nextSequentialPage: 14,
    }),
    10
  );

  assert.equal(
    computeResumeFromStateSnapshot({
      deferred: [
        [9, 1],
        [3, 2],
      ],
    }),
    3
  );

  assert.equal(computeResumeFromStateSnapshot({}), null);
});

test('snapshot: serialize/restore problems roundtrip', () => {
  const original = {
    id: 42,
    name: 'foo',
    link: 'https://www.pbinfo.ro/probleme/42/foo',
    difficulty: 1,
    status: 'tried',
    quality: 'verified',
    verifiedAt: 123456789,
    userScore: 55,
    maxScore: 100,
    postedBy_link: 'https://www.pbinfo.ro/utilizator/1/x',
    postedBy_name: 'X',
    postedBy_img: 'https://example.com/avatar.png',
    author: 'Author',
    source: 'Source',
  };

  const snapshot = {
    problems: [serializeProblemForSnapshot(original, 'full')],
    seenProblemIds: [42],
  };

  const restored = restoreProblemsFromSnapshot(snapshot);
  assert.equal(restored.allProblems.length, 1);
  assert.ok(restored.seenProblemIds.has(42));

  const p = restored.allProblems[0];
  assert.equal(p.id, 42);
  assert.equal(p.name, 'foo');
  assert.equal(p.link, 'https://www.pbinfo.ro/probleme/42/foo');
  assert.equal(p.difficulty, 1);
  assert.equal(p.status, 'tried');
  assert.equal(p.quality, 'verified');
  assert.equal(p.verifiedAt, 123456789);
  assert.equal(p.userScore, 55);
  assert.equal(p.maxScore, 100);
  assert.equal(p.scoreKnown, true);
  assert.equal(p.score, 55);
  assert.equal(p.postedBy_name, 'X');
  assert.equal(p.author, 'Author');
  assert.equal(p.source, 'Source');
});

test('snapshot: restoreProblemFromSnapshotEntry normalizes status, quality, and invalid ids', () => {
  const restored = restoreProblemFromSnapshotEntry(
    {
      id: 7,
      name: 'bar',
      link: 'https://www.pbinfo.ro/probleme/7/bar',
      status: 'broken',
      quality: 'mystery',
      verifiedAt: 'nope',
      userScore: 100,
      maxScore: 100,
    },
    2
  );

  assert.equal(restored.cnt, 3);
  assert.equal(restored.id, 7);
  assert.equal(restored.status, 'solved');
  assert.equal(restored.quality, 'scan-only');
  assert.equal(restored.verifiedAt, null);
  assert.equal(restored.scoreKnown, true);
  assert.equal(restored.score, 100);

  assert.equal(
    restoreProblemFromSnapshotEntry(
      {
        id: 'NaN',
        name: 'ignored',
      },
      0
    ),
    null
  );

  assert.equal(restoreProblemFromSnapshotEntry(null, 0), null);
});
