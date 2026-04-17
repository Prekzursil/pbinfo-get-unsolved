'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { projectSnapshotForLevel } = require('../pbinfo-get-unsolved-enhanced.js');

test('projectSnapshotForLevel: null / non-snapshot inputs return null', () => {
  assert.equal(projectSnapshotForLevel(null, 'full'), null);
  assert.equal(projectSnapshotForLevel('nope', 'full'), null);
});

test('projectSnapshotForLevel: full keeps problem details, minimal trims them', () => {
  const snapshot = {
    pageLink: 'https://www.pbinfo.ro/?pagina=probleme-lista',
    seenProblemIds: [1, 2],
    problems: [
      {
        id: 1,
        name: 'p1',
        link: '/1',
        difficulty: 0,
        status: 'tried',
        userScore: 50,
        maxScore: 100,
        postedBy_name: 'alice',
        author: 'auth',
        source: 'src',
      },
    ],
  };
  const full = projectSnapshotForLevel(snapshot, 'full');
  assert.equal(full.storageLevel, 'full');
  assert.equal(full.problems[0].postedBy_name, 'alice');
  assert.equal(full.problems[0].author, 'auth');

  const minimal = projectSnapshotForLevel(snapshot, 'minimal');
  assert.equal(minimal.storageLevel, 'minimal');
  assert.ok(!('postedBy_name' in minimal.problems[0]));
});

test('projectSnapshotForLevel: progress drops the problems array', () => {
  const snapshot = {
    pageLink: 'x',
    problems: [{ id: 1, name: 'p', link: '/1' }],
  };
  const progress = projectSnapshotForLevel(snapshot, 'progress');
  assert.ok(!('problems' in progress));
  assert.equal(progress.storageLevel, 'progress');
});

test('projectSnapshotForLevel: bogus level falls back to minimal', () => {
  const snapshot = { pageLink: 'x', problems: [] };
  const out = projectSnapshotForLevel(snapshot, 'nonsense');
  assert.equal(out.storageLevel, 'minimal');
});

test('projectSnapshotForLevel: pageLink override wins over snapshot pageLink', () => {
  const snapshot = { pageLink: 'old', problems: [] };
  const out = projectSnapshotForLevel(snapshot, 'full', { pageLink: 'new' });
  assert.equal(out.pageLink, 'new');
});

test('projectSnapshotForLevel: supplies default empty seenProblemIds', () => {
  const snapshot = { pageLink: 'x' };
  const out = projectSnapshotForLevel(snapshot, 'full');
  assert.deepEqual(out.seenProblemIds, []);
});
