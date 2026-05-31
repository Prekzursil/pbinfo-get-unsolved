'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');

const {
  buildScoreCandidatesFromCard,
  extractScoreInfoFromCard,
  extractProblemMetaFromProblemPage,
  getTooltipText,
  migrateStateSnapshotToV2,
  extractSnapshotFromImport,
} = require('../pbinfo-get-unsolved-enhanced.js');

function cardFrom(html) {
  const { document } = parseHTML(`<div class="card mb-3">${html}</div>`);
  return document.querySelector('div.card.mb-3');
}

test('buildScoreCandidatesFromCard: badge in card-footer is captured', () => {
  const card = cardFrom('<div class="card-footer"><span class="badge">25</span></div>');
  const cands = buildScoreCandidatesFromCard(card);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].value, 25);
});

test('buildScoreCandidatesFromCard: badge inside Rezolva solve-button is captured', () => {
  const card = cardFrom(
    '<a class="btn btn-primary" href="/x">Rezolvă <span class="badge">30</span></a>'
  );
  const cands = buildScoreCandidatesFromCard(card);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].value, 30);
});

test('buildScoreCandidatesFromCard: bare badge with no score markers is skipped', () => {
  const card = cardFrom('<span class="badge">42</span>');
  assert.equal(buildScoreCandidatesFromCard(card).length, 0);
});

test('buildScoreCandidatesFromCard: badge starting with # is skipped', () => {
  const card = cardFrom('<span class="badge">#7</span>');
  assert.equal(buildScoreCandidatesFromCard(card).length, 0);
});

test('buildScoreCandidatesFromCard: badge with "p" word looks like score', () => {
  const card = cardFrom('<span class="badge">15 p</span>');
  const cands = buildScoreCandidatesFromCard(card);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].value, 15);
});

test('buildScoreCandidatesFromCard: badge with score tooltip captured outside footer', () => {
  const card = cardFrom('<span class="badge" title="Punctaj obținut">88</span>');
  const info = extractScoreInfoFromCard(card);
  assert.equal(info.userScore, 88);
});

test('getTooltipText: returns first present tooltip attr', () => {
  const { document } = parseHTML('<span data-bs-title="Punctaj">x</span>');
  const el = document.querySelector('span');
  assert.equal(getTooltipText(el), 'Punctaj');
});

test('getTooltipText: empty when no tooltip attr', () => {
  const { document } = parseHTML('<span>x</span>');
  assert.equal(getTooltipText(document.querySelector('span')), '');
});

test('extractProblemMetaFromProblemPage: og:title fallback fills name', () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Problema Test - pbinfo.ro online" />
  </head><body></body></html>`;
  const { document } = parseHTML(html);
  const meta = extractProblemMetaFromProblemPage(document, 5);
  assert.equal(meta.name, 'Problema Test');
});

test('extractProblemMetaFromProblemPage: title fallback when no og:title', () => {
  const html = `<!doctype html><html><head><title>Alta - pbinfo.ro</title></head><body></body></html>`;
  const { document } = parseHTML(html);
  const meta = extractProblemMetaFromProblemPage(document, 6);
  assert.equal(meta.name, 'Alta');
});

test('extractProblemMetaFromProblemPage: difficulty read from table cell', () => {
  const html = `<!doctype html><html><body>
    <h1>#9 Titlu</h1>
    <table><tr>
      <td><a href="/u"><img src="/p.png">Autor</a></td>
      <td>sursa</td>
      <td>autor</td>
      <td>Concurs</td>
      <td id="scor_utilizator_problema"><span class="badge">50</span></td>
    </tr></table>
  </body></html>`;
  const { document } = parseHTML(html);
  const meta = extractProblemMetaFromProblemPage(document, 9);
  assert.equal(meta.difficulty, 3);
});

test('migrateStateSnapshotToV2: array-of-problems source becomes minimal level', () => {
  const v1 = {
    version: 1,
    pageLink: 'https://www.pbinfo.ro/x',
    problems: [{ id: 1, name: 'a', link: '/1', status: 'tried' }],
  };
  const migrated = migrateStateSnapshotToV2(v1);
  assert.ok(migrated);
  assert.equal(migrated.schemaVersion ?? migrated.version, 2);
});

test('migrateStateSnapshotToV2: returns null for non-object', () => {
  assert.equal(migrateStateSnapshotToV2(null), null);
  assert.equal(migrateStateSnapshotToV2('nope'), null);
});

test('extractSnapshotFromImport: unwraps {state} payload', () => {
  const payload = {
    type: 'pbinfo-get-unsolved-snapshot',
    state: { version: 2, pageLink: 'https://www.pbinfo.ro/y', problems: [] },
  };
  const snap = extractSnapshotFromImport(payload);
  assert.ok(snap);
  assert.equal(snap.pageLink, 'https://www.pbinfo.ro/y');
});

test('extractSnapshotFromImport: accepts bare snapshot object', () => {
  const bare = { version: 2, pageLink: 'https://www.pbinfo.ro/z', problems: [] };
  const snap = extractSnapshotFromImport(bare);
  assert.ok(snap);
  assert.equal(snap.pageLink, 'https://www.pbinfo.ro/z');
});
