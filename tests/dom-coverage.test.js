'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseHTML } = require('linkedom');

const {
  buildScoreCandidatesFromCard,
  extractScoreInfoFromCard,
  extractProblemMetaFromProblemPage,
} = require('../pbinfo-get-unsolved-enhanced.js');

function cardFrom(html) {
  const { document } = parseHTML(`<div class="card mb-3">${html}</div>`);
  return document.querySelector('div.card.mb-3');
}

test('buildScoreCandidatesFromCard: badge inside card-footer without tooltip still captured', () => {
  const card = cardFrom(`
    <div class="card-footer">
      <span class="badge">25</span>
    </div>
  `);
  const cands = buildScoreCandidatesFromCard(card);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].value, 25);
});

test('buildScoreCandidatesFromCard: badge inside Rezolva button captured via solve-button branch', () => {
  const card = cardFrom(`
    <a class="btn btn-primary" href="/probleme/1/edit">
      Rezolva <span class="badge">30</span>
    </a>
  `);
  const cands = buildScoreCandidatesFromCard(card);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].value, 30);
});

test('buildScoreCandidatesFromCard: badge leading with # is skipped', () => {
  const card = cardFrom(`<span class="badge">#42</span>`);
  const cands = buildScoreCandidatesFromCard(card);
  assert.equal(cands.length, 0);
});

test('buildScoreCandidatesFromCard: tooltip that is not score-like is skipped', () => {
  const card = cardFrom(`<span title="Autor" data-original-title="Autor">20</span>`);
  // "Autor" is not a score tooltip, no badge or footer context -> skipped entirely.
  const cands = buildScoreCandidatesFromCard(card);
  assert.equal(cands.length, 0);
});

test('buildScoreCandidatesFromCard: badge outside footer and without score markers is skipped', () => {
  const card = cardFrom(`<span class="badge">42</span>`);
  const cands = buildScoreCandidatesFromCard(card);
  assert.equal(cands.length, 0);
});

test('buildScoreCandidatesFromCard: anchor with score tooltip picks up isLink=true', () => {
  const card = cardFrom(`<a class="something" href="/x" title="Punctaj obținut">85p</a>`);
  const info = extractScoreInfoFromCard(card);
  assert.equal(info.userScore, 85);
});

test('buildScoreCandidatesFromCard: tooltip-less numeric span with \\bp\\b word passes looksLikeScoreText', () => {
  const card = cardFrom(`<span class="badge">15 p</span>`);
  const cands = buildScoreCandidatesFromCard(card);
  // Not in footer, not in Rezolva — but \bp\b matches
  assert.equal(cands.length, 1);
  assert.equal(cands[0].value, 15);
});

test('extractProblemMetaFromProblemPage: difficulty keywords (med / dific / conc) each route', () => {
  const mk = (difficultyLabel) => {
    const html = `<!doctype html><html><body>
      <h1>#7 My title</h1>
      <table>
        <tr>
          <td><a href="/user/x"><img src="/pic.png">The Author</a></td>
          <td>src</td>
          <td>author</td>
          <td>${difficultyLabel}</td>
          <td id="scor_utilizator_problema"><span class="badge">50</span></td>
        </tr>
      </table>
    </body></html>`;
    const { document } = parseHTML(html);
    return extractProblemMetaFromProblemPage(document, 7);
  };

  assert.equal(mk('Ușor').difficulty, 0);
  assert.equal(mk('Mediu').difficulty, 1);
  assert.equal(mk('Dificil').difficulty, 2);
  assert.equal(mk('Concurs').difficulty, 3);
  assert.equal(mk('Unknown').difficulty, 3);
});

test('extractProblemMetaFromProblemPage: author/source dashes map to empty strings', () => {
  const html = `<!doctype html><html><body>
    <h1>#7 My title</h1>
    <table>
      <tr>
        <td><a href="/user/x"><img src="/pic.png">Poster</a></td>
        <td>-</td>
        <td>-</td>
        <td>Mediu</td>
        <td id="scor_utilizator_problema"><span class="badge">50</span></td>
      </tr>
    </table>
  </body></html>`;
  const { document } = parseHTML(html);
  const meta = extractProblemMetaFromProblemPage(document, 7);
  assert.equal(meta.author, '');
  assert.equal(meta.source, '');
});

test('extractProblemMetaFromProblemPage: og:title fallback when heading missing', () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="My Title - pbinfo.ro something">
    <title>ignored</title>
  </head><body></body></html>`;
  const { document } = parseHTML(html);
  const meta = extractProblemMetaFromProblemPage(document, null);
  assert.equal(meta.name, 'My Title');
});

test('extractProblemMetaFromProblemPage: document title fallback when og missing', () => {
  const html = `<!doctype html><html><head>
    <title>Only Title - pbinfo.ro</title>
  </head><body></body></html>`;
  const { document } = parseHTML(html);
  const meta = extractProblemMetaFromProblemPage(document, null);
  assert.equal(meta.name, 'Only Title');
});

test('extractProblemMetaFromProblemPage: heading keeps content when prefix does not match', () => {
  const html = `<!doctype html><html><body>
    <h1>Plain Title Without Id</h1>
  </body></html>`;
  const { document } = parseHTML(html);
  const meta = extractProblemMetaFromProblemPage(document, 42);
  assert.equal(meta.name, 'Plain Title Without Id');
});
