const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');

const {
  parseListProblemCard,
  parseIdRangeProblemPage,
  createIdRangeProblemFromKnownScore,
} = require('../src/core/runtime-page-parsing');

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

function parseCardFixture(name) {
  const { document } = parseHTML(loadFixture(name));
  return document.querySelector('div.card.mb-3');
}

function parseDocumentFixture(name) {
  const { document } = parseHTML(loadFixture(name));
  return document;
}

test('runtime page parsing: list card parser keeps id/name/status shape for normal cards', () => {
  const card = parseCardFixture('card-score-title.html');
  const parsed = parseListProblemCard(card);

  assert.equal(parsed.kind, 'ok');
  assert.equal(parsed.id, 4926);
  assert.equal(parsed.problem.name, 'Pandemica');
  assert.equal(parsed.problem.link, '/probleme/4926/pandemica');
  assert.equal(parsed.problem.status, 'tried');
  assert.equal(parsed.problem.userScore, 0);
  assert.equal(parsed.problem.maxScore, 100);
  assert.equal(parsed.parseFailed, false);
});

test('runtime page parsing: list card parser handles invalid ids and avatar normalization', () => {
  const html = `
    <div class="card mb-3">
      <div><code>#abc</code></div>
    </div>
  `;
  const invalidDoc = parseHTML(html).document;
  const invalidCard = invalidDoc.querySelector('div.card.mb-3');
  const invalidResult = parseListProblemCard(invalidCard);
  assert.equal(invalidResult.kind, 'invalid-id');

  const avatarHtml = `
    <div class="card mb-3">
      <div class="card-header">
        <h5 class="card-title"><a href="/probleme/10/test">test</a></h5>
        <code>#10</code>
      </div>
      <div class="card-body">
        <span class="badge" title="Punctaj obținut">15p</span>
      </div>
      <span title="Postată de">
        <a href="/utilizator/1/demo">demo <img src="https://www.gravatar.com/avatar/x?d=identicon&s=32" /></a>
      </span>
    </div>
  `;
  const avatarDoc = parseHTML(avatarHtml).document;
  const avatarCard = avatarDoc.querySelector('div.card.mb-3');
  const avatarResult = parseListProblemCard(avatarCard);

  assert.equal(avatarResult.kind, 'ok');
  assert.equal(
    avatarResult.problem.postedBy_img,
    'https://www.gravatar.com/avatar/x?d=identicon&s=128'
  );
});

test('runtime page parsing: list parser handles skip branch and pbinfo avatar resizing', () => {
  const skipDoc = parseHTML('<div class="card mb-3"><div class="card-body"></div></div>').document;
  const skipped = parseListProblemCard(skipDoc.querySelector('div.card.mb-3'));
  assert.equal(skipped.kind, 'skip');

  const html = `
    <div class="card mb-3">
      <div class="card-header">
        <h5 class="card-title"><a>  Test cu dificultate  </a></h5>
        <code>#22</code>
      </div>
      <div class="card-body">
        <span class="badge" title="Punctaj obținut">10p</span>
        <span title="Dificultate">Dificil</span>
      </div>
      <span title="Postată de">
        <a href="/utilizator/22/demo">demo <img src="https://www.pbinfo.ro/profile.png?x=1&gsize=64" /></a>
      </span>
      <span title="Autor"></span>
      <blockquote title="Sursa problemei"></blockquote>
    </div>
  `;
  const document = parseHTML(html).document;
  const parsed = parseListProblemCard(document.querySelector('div.card.mb-3'));

  assert.equal(parsed.kind, 'ok');
  assert.equal(parsed.problem.name, 'Test cu dificultate');
  assert.equal(parsed.problem.difficulty, 2);
  assert.equal(parsed.problem.postedBy_img, 'https://www.pbinfo.ro/profile.png?x=1&gsize=128');
  assert.equal(parsed.problem.author, '');
  assert.equal(parsed.problem.source, '');
});

test('runtime page parsing: id-range parser preserves parsed score when already present', () => {
  const document = parseDocumentFixture('problem-page-score-42.html');
  const parsed = parseIdRangeProblemPage({
    pageDoc: document,
    pageIndex: 2,
    knownIdRangeScore: 99,
    locationOrigin: 'https://www.pbinfo.ro',
  });

  assert.equal(parsed.hasUserScoreNode, true);
  assert.equal(parsed.problem.link, 'https://www.pbinfo.ro/probleme/2/foo');
  assert.equal(parsed.problem.status, 'tried');
  assert.equal(parsed.problem.userScore, 42);
  assert.equal(parsed.problem.maxScore, 100);
});

test('runtime page parsing: id-range parser can fall back to known score for scoreless pages', () => {
  const document = parseDocumentFixture('problem-page-no-score.html');
  const parsed = parseIdRangeProblemPage({
    pageDoc: document,
    pageIndex: 8000,
    knownIdRangeScore: 73,
    locationOrigin: 'https://www.pbinfo.ro',
  });

  assert.equal(parsed.hasUserScoreNode, false);
  assert.equal(parsed.problem.link, 'https://www.pbinfo.ro/probleme/8000');
  assert.equal(parsed.problem.userScore, 73);
  assert.equal(parsed.problem.maxScore, 100);
  assert.equal(parsed.problem.status, 'tried');
});

test('runtime page parsing: known score helper builds solved/tried id-range records', () => {
  const solved = createIdRangeProblemFromKnownScore({
    problemId: 11,
    scoreValue: 100,
    locationOrigin: 'https://www.pbinfo.ro',
  });
  const tried = createIdRangeProblemFromKnownScore({
    problemId: 12,
    scoreValue: 47,
    locationOrigin: 'https://www.pbinfo.ro',
  });

  assert.equal(solved.status, 'solved');
  assert.equal(solved.link, 'https://www.pbinfo.ro/probleme/11');
  assert.equal(tried.status, 'tried');
  assert.equal(tried.userScore, 47);
});

test('runtime page parsing: known score helper rejects invalid payloads and id-range uses default origin', () => {
  const invalid = createIdRangeProblemFromKnownScore({
    problemId: Number.NaN,
    scoreValue: 10,
    locationOrigin: 'https://www.pbinfo.ro',
  });
  assert.equal(invalid, null);

  const document = parseDocumentFixture('problem-page-no-score.html');
  const parsed = parseIdRangeProblemPage({
    pageDoc: document,
    pageIndex: 9001,
    knownIdRangeScore: Number.NaN,
  });

  assert.equal(parsed.problem.link, 'https://www.pbinfo.ro/probleme/9001');
  assert.equal(parsed.problem.scoreKnown, false);
  assert.equal(parsed.problem.status, 'unattempted');
});

test('runtime page parsing: list parser covers innerText path and avatar fallback branches', () => {
  const easyHtml = `
    <div class="card mb-3">
      <div class="card-header">
        <h5 class="card-title"><a href="/probleme/31/test"></a></h5>
        <code>#31</code>
      </div>
      <div class="card-body">
        <span class="badge" title="Punctaj obținut">1p</span>
        <span title="Dificultate">ușor</span>
      </div>
      <span title="Postată de">
        <a href="/utilizator/31/demo">demo <img src="::::" /></a>
      </span>
    </div>
  `;
  const easyDoc = parseHTML(easyHtml).document;
  const easyNameAnchor = easyDoc.querySelector('h5.card-title a');
  Object.defineProperty(easyNameAnchor, 'innerText', {
    value: '  Easy Name  ',
    configurable: true,
  });
  const easyParsed = parseListProblemCard(easyDoc.querySelector('div.card.mb-3'));

  assert.equal(easyParsed.kind, 'ok');
  assert.equal(easyParsed.problem.name, 'Easy Name');
  assert.equal(easyParsed.problem.difficulty, 0);
  assert.equal(easyParsed.problem.postedBy_img, '::::');

  const mediumHtml = `
    <div class="card mb-3">
      <div class="card-header">
        <h5 class="card-title"><a href="/probleme/32/test">Medium Name</a></h5>
        <code>#32</code>
      </div>
      <div class="card-body">
        <span class="badge" title="Punctaj obținut">2p</span>
        <span title="Dificultate">mediu</span>
      </div>
      <span title="Postată de">
        <a href="/utilizator/32/demo">demo</a>
      </span>
    </div>
  `;
  const mediumDoc = parseHTML(mediumHtml).document;
  const mediumParsed = parseListProblemCard(mediumDoc.querySelector('div.card.mb-3'));

  assert.equal(mediumParsed.kind, 'ok');
  assert.equal(mediumParsed.problem.difficulty, 1);
  assert.equal(mediumParsed.problem.postedBy_img, '');
});

test('runtime page parsing: list parser prefers innerText when provided on anchor nodes', () => {
  const fakeCard = {
    querySelector(selector) {
      if (selector === 'code') return { textContent: '#55' };
      if (selector === 'h5.card-title a') {
        return {
          innerText: '  Name from innerText  ',
          textContent: 'Name from textContent',
          href: '/probleme/55/test',
        };
      }
      return null;
    },
  };

  const parsed = parseListProblemCard(fakeCard);

  assert.equal(parsed.kind, 'ok');
  assert.equal(parsed.problem.name, 'Name from innerText');
});

test('runtime page parsing: list parser falls back to textContent when innerText is not a string', () => {
  const fakeCard = {
    querySelector(selector) {
      if (selector === 'code') return { textContent: '#56' };
      if (selector === 'h5.card-title a') {
        return {
          innerText: 56,
          textContent: 'Name from textContent fallback',
          href: '/probleme/56/test',
        };
      }
      return null;
    },
  };

  const parsed = parseListProblemCard(fakeCard);

  assert.equal(parsed.kind, 'ok');
  assert.equal(parsed.problem.name, 'Name from textContent fallback');
});
