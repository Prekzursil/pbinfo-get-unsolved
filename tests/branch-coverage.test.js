const test = require('node:test');
const assert = require('node:assert/strict');

const { parseHTML } = require('linkedom');

const {
  selectScoreFromCandidates,
  buildScoreCandidatesFromCard,
  extractScoreInfoFromCard,
  extractScoreInfoFromProblemPage,
  extractProblemMetaFromProblemPage,
  parseTotalProblems,
  normalizeListUrl,
  buildPageUrl,
  computeBackoffWithJitter,
  nextAdaptiveThrottleState,
  migrateStateSnapshotToV2,
  problemsToCsv,
  problemsToLinksText,
  problemsToIdsText,
  problemsToMarkdownText,
  restoreProblemsFromSnapshot,
} = require('../pbinfo-get-unsolved-enhanced.js');

function parseCard(html) {
  const { document } = parseHTML(html);
  return document.querySelector('div.card.mb-3') || document.querySelector('div.card');
}
function parseDocument(html) {
  return parseHTML(html).document;
}

// ── selectScoreFromCandidates: maxim/score-word AND-arms (lines 49-52) ──
test('select: "Punctaj maxim" tooltip short-circuits to max-points', () => {
  const r = selectScoreFromCandidates([
    { tooltip: 'Punctaj maxim', text: '', value: 100, max: null, hasRatio: false },
    { tooltip: 'obtinut', text: '40', value: 40, max: null, hasRatio: false },
  ]);
  assert.equal(r.maxScore, 100);
  assert.equal(r.userScore, 40);
});

test('select: "maxim" with no score-word is NOT treated as max points', () => {
  // hasMaxHint true but hasScoreWord false -> isMaxPointsCand false (line 52 false arm)
  const r = selectScoreFromCandidates([
    { tooltip: 'nivel maxim', text: '90', value: 90, max: null, hasRatio: false },
  ]);
  assert.equal(r.userScore, 90);
});

test('select: "maxim scor" (max hint + score word, not user) -> max points', () => {
  const r = selectScoreFromCandidates([
    { tooltip: 'scor maxim posibil', text: '100', value: 100, max: null, hasRatio: false },
    { tooltip: 'realizat', text: '70', value: 70, max: null, hasRatio: false },
  ]);
  assert.equal(r.maxScore, 100);
  assert.equal(r.userScore, 70);
});

test('select: ranking favors ratio and link candidates', () => {
  const r = selectScoreFromCandidates([
    { tooltip: '', text: '10', value: 10, max: 100, hasRatio: false, isLink: false },
    { tooltip: '', text: '30/100', value: 30, max: 100, hasRatio: true, isLink: true },
  ]);
  assert.equal(r.userScore, 30);
  assert.equal(r.maxScore, 100);
});

test('select: best candidate with non-finite value yields null user score', () => {
  const r = selectScoreFromCandidates([
    { tooltip: '', text: '', value: NaN, max: null, hasRatio: false },
  ]);
  assert.equal(r.userScore, null);
});

test('select: empty candidate list returns nulls', () => {
  const r = selectScoreFromCandidates([]);
  assert.deepEqual(r, { userScore: null, maxScore: null });
});

// ── buildScoreCandidatesFromCard: tooltip-without-score-word skipped (lines 113,119) ──
test('candidates: tooltip element without score word and unparseable text is skipped', () => {
  const card = parseCard(`<div class="card mb-3">
      <span title="autor necunoscut">fără scor</span>
      <span class="badge" title="Punctaj utilizator">no-number-here</span>
    </div>`);
  const cands = buildScoreCandidatesFromCard(card);
  assert.deepEqual(cands, []);
});

test('candidates: solve-button badge with "rezolva" is accepted as score', () => {
  const card = parseCard(`<div class="card mb-3">
      <a class="btn">Rezolvă <span class="badge">45 / 100</span></a>
    </div>`);
  const info = extractScoreInfoFromCard(card);
  assert.equal(info.userScore, 45);
  assert.equal(info.maxScore, 100);
});

test('candidates: tooltip attribute present but empty is skipped (line 113)', () => {
  // [title] selector matches, but getTooltipText returns '' -> `if (!tooltip) continue`.
  const card = parseCard(`<div class="card mb-3">
      <span title="">empty-title</span>
    </div>`);
  assert.deepEqual(buildScoreCandidatesFromCard(card), []);
});

test('candidates: badge starting with "#" id is filtered out', () => {
  const card = parseCard(`<div class="card mb-3">
      <span class="badge">#1234</span>
    </div>`);
  assert.deepEqual(buildScoreCandidatesFromCard(card), []);
});

// ── line 150: exhaustively cover each `&&` operand of the badge-accept guard.
// Each case keeps the PRECEDING operands false so the next operand is evaluated
// both ways deterministically (so the fuzz test is never the coverage provider).
test('candidates(line150): operand1 true — "p"-marked text is accepted (looksLikeScoreText)', () => {
  // `/\bp\b/i` needs `p` as a standalone token, e.g. "45 p".
  const card = parseCard(`<div class="card mb-3"><span class="badge">45 p</span></div>`);
  const c = buildScoreCandidatesFromCard(card);
  assert.equal(c.length, 1);
  assert.equal(c[0].value, 45);
});

test('candidates(line150): operand1 true — ratio text is accepted (parsed.hasRatio)', () => {
  const card = parseCard(`<div class="card mb-3"><span class="badge">30 / 100</span></div>`);
  const c = buildScoreCandidatesFromCard(card);
  assert.equal(c.length, 1);
  assert.equal(c[0].hasRatio, true);
});

test('candidates(line150): operand2 true — score tooltip accepts plain-number badge', () => {
  // looksLikeScoreText false (no "p", no ratio), but hasScoreTooltip true.
  const card = parseCard(
    `<div class="card mb-3"><span class="badge" title="Punctaj utilizator">80</span></div>`
  );
  const c = buildScoreCandidatesFromCard(card);
  assert.equal(c.length, 1);
  assert.equal(c[0].value, 80);
});

test('candidates(line150): operand3 true — footer placement accepts plain-number badge', () => {
  // looksLikeScoreText false, hasScoreTooltip false, withinFooter true.
  const card = parseCard(
    `<div class="card mb-3"><div class="card-footer"><span class="badge">70</span></div></div>`
  );
  const c = buildScoreCandidatesFromCard(card);
  assert.equal(c.length, 1);
  assert.equal(c[0].value, 70);
});

test('candidates(line150): operand4 true — solve-button placement (no "rezolv") is rejected', () => {
  // op1/op2/op3 false; op4 evaluated: a.btn present but text lacks "rezolv" -> false -> skip.
  const card = parseCard(
    `<div class="card mb-3"><a class="btn">Detalii <span class="badge">55</span></a></div>`
  );
  assert.deepEqual(buildScoreCandidatesFromCard(card), []);
});

test('candidates(line150): all operands false — plain badge with no score signal is skipped', () => {
  const card = parseCard(`<div class="card mb-3"><span class="badge">12</span></div>`);
  assert.deepEqual(buildScoreCandidatesFromCard(card), []);
});

test('candidates(line150): solve-button WITH "rezolva" is accepted (op4 true path)', () => {
  const card = parseCard(
    `<div class="card mb-3"><a class="btn">Rezolvă acum <span class="badge">60</span></a></div>`
  );
  const c = buildScoreCandidatesFromCard(card);
  assert.equal(c.length, 1);
  assert.equal(c[0].value, 60);
});

test('candidates(line150): badge with no a.btn ancestor leaves withinSolveButton false', () => {
  // exercises the `if (!btn) return false` arm of the withinSolveButton IIFE (line 144)
  const card = parseCard(`<div class="card mb-3"><span class="badge">88</span></div>`);
  assert.deepEqual(buildScoreCandidatesFromCard(card), []);
});

// ── extractScoreInfoFromProblemPage: preferred-element fallbacks (lines 178,180,193) ──
test('score (page): falls back to cell firstElementChild then cell tooltip', () => {
  const doc = parseDocument(`<!doctype html><body>
      <td id="scor_utilizator_problema" title="Punctaj 88 / 100"><b></b></td>
    </body>`);
  const info = extractScoreInfoFromProblemPage(doc);
  assert.equal(info.userScore, 88);
  assert.equal(info.maxScore, 100);
});

test('score (page): no parseable score yields null user/max', () => {
  const doc = parseDocument(`<!doctype html><body>
      <td id="scor_utilizator_problema"><span>fara punctaj</span></td>
    </body>`);
  const info = extractScoreInfoFromProblemPage(doc);
  assert.equal(info.userScore, null);
  assert.equal(info.maxScore, null);
});

// ── extractProblemMetaFromProblemPage: heading with id prefix (lines 213-214) ──
test('meta: heading id prefix is stripped from the name', () => {
  const doc = parseDocument(`<!doctype html><body><h1>#42 - Suma</h1></body>`);
  const meta = extractProblemMetaFromProblemPage(doc, 42);
  assert.equal(meta.name, 'Suma');
});

test('meta: heading without id prefix keeps the full name', () => {
  const doc = parseDocument(`<!doctype html><body><h2>Numere</h2></body>`);
  const meta = extractProblemMetaFromProblemPage(doc, null);
  assert.equal(meta.name, 'Numere');
});

test('meta: postedBy anchor without img leaves postedBy_img empty (line 255)', () => {
  const doc = parseDocument(`<!doctype html><body><table><tr>
      <td><a href="https://www.pbinfo.ro/u/1">User</a></td>
      <td id="scor_utilizator_problema">10</td>
    </tr></table></body>`);
  const meta = extractProblemMetaFromProblemPage(doc, null);
  assert.equal(meta.postedBy_name, 'User');
  assert.equal(meta.postedBy_img, '');
});

test('meta: postedBy anchor without href falls back to empty link (line 255 ||)', () => {
  const doc = parseDocument(`<!doctype html><body><table><tr>
      <td><a>NoHref</a></td>
      <td id="scor_utilizator_problema">10</td>
    </tr></table></body>`);
  const meta = extractProblemMetaFromProblemPage(doc, null);
  assert.equal(meta.postedBy_name, 'NoHref');
  assert.equal(meta.postedBy_link, '');
});

// ── normalizeListUrl: base-only path exercises `raw || base` / `base || undefined` (line 299) ──
test('normalizeListUrl: empty input falls back to base url and strips pagination', () => {
  const url = normalizeListUrl('', 'https://www.pbinfo.ro/?pagina=lista&start=40', 'start');
  assert.equal(url, 'https://www.pbinfo.ro/?pagina=lista');
});

// ── parseTotalProblems: no-match and non-finite arms (lines 287-290) ──
test('parseTotalProblems: missing marker returns null', () => {
  assert.equal(parseTotalProblems('<div>nothing</div>'), null);
});

test('parseTotalProblems: nullish input returns null', () => {
  assert.equal(parseTotalProblems(null), null);
});

// ── buildPageUrl: pageBase / pageSize defaults (lines 314, 318) ──
test('buildPageUrl: page mode with non-finite pageBase defaults to 1', () => {
  const url = buildPageUrl('https://x/?a=1', {
    pageIndex: 2,
    mode: 'page',
    param: 'p',
    pageBase: NaN,
  });
  assert.equal(url, 'https://x/?a=1&p=2');
});

test('buildPageUrl: offset mode with non-finite pageSize defaults to 10', () => {
  const url = buildPageUrl('https://x/?a=1', {
    pageIndex: 3,
    pageSize: NaN,
    mode: 'offset',
    param: 's',
  });
  assert.equal(url, 'https://x/?a=1&s=20');
});

// ── computeBackoffWithJitter: defensive arms (lines 327-333) ──
test('backoff: non-finite attempt/base/cap fall back to defaults', () => {
  const v = computeBackoffWithJitter(NaN, { baseMs: NaN, capMs: NaN, jitter: false });
  assert.equal(v, 500);
});

test('backoff: jitter with non-function random uses Math.random bounds', () => {
  const v = computeBackoffWithJitter(2, { baseMs: 100, capMs: 10000, jitter: true, random: 42 });
  assert.ok(v >= 0 && v <= 400);
});

test('backoff: random returning non-finite is clamped', () => {
  const v = computeBackoffWithJitter(1, { baseMs: 100, jitter: true, random: () => NaN });
  assert.ok(Number.isFinite(v) && v >= 0);
});

test('backoff: no jitter returns exact exponential', () => {
  assert.equal(computeBackoffWithJitter(3, { baseMs: 100, capMs: 10000, jitter: false }), 800);
});

// ── nextAdaptiveThrottleState: defensive coercions + disabled (lines 338-351) ──
test('throttle: disabled state returns immediately', () => {
  const r = nextAdaptiveThrottleState({ enabled: false }, 'blocked');
  assert.equal(r.enabled, false);
});

test('throttle: non-object state and bad numeric fields coerce to defaults', () => {
  const r = nextAdaptiveThrottleState(undefined, 'success');
  assert.equal(r.enabled, true);
  assert.equal(r.delayMs, 0);
  assert.equal(r.concurrency, 1);
  assert.equal(r.cleanStreak, 1);
});

test('throttle: non-finite capMs falls back to 15000 cap on blocked', () => {
  const r = nextAdaptiveThrottleState(
    { delayMs: 9000, concurrency: 4, baseDelayMs: 0 },
    'blocked',
    { capMs: NaN }
  );
  assert.equal(r.concurrency, 1);
  assert.ok(r.delayMs <= 15000 && r.delayMs > 0);
});

test('throttle: 20 clean successes relax delay and raise concurrency', () => {
  let s = { enabled: true, delayMs: 1000, concurrency: 1, baseConcurrency: 3, baseDelayMs: 0 };
  for (let i = 0; i < 20; i++) s = nextAdaptiveThrottleState(s, 'success');
  assert.equal(s.cleanStreak, 0);
  assert.equal(s.concurrency, 2);
  assert.ok(s.delayMs < 1000);
});

test('throttle: error event reduces concurrency and bumps delay', () => {
  const r = nextAdaptiveThrottleState(
    { enabled: true, delayMs: 100, concurrency: 3, baseDelayMs: 0 },
    'error'
  );
  assert.equal(r.concurrency, 2);
  assert.ok(r.delayMs >= 350);
});

// ── migrateStateSnapshotToV2: stats defensive arms (lines 427-428) ──
test('migrate: non-finite stats fields default to 0', () => {
  const out = migrateStateSnapshotToV2({
    storageLevel: 'progress',
    stats: { forbidden: 'x', missing: undefined, pages: 5 },
  });
  assert.equal(out.stats.forbidden, 0);
  assert.equal(out.stats.missing, 0);
  assert.equal(out.stats.pages, 5);
});

test('migrate: finite missing/forbidden stats are preserved (lines 427-428)', () => {
  const out = migrateStateSnapshotToV2({
    storageLevel: 'progress',
    stats: { solved: 3, tried: 2, unattempted: 1, total: 6, pages: 4, missing: 7, forbidden: 9 },
  });
  assert.equal(out.stats.missing, 7);
  assert.equal(out.stats.forbidden, 9);
  assert.equal(out.stats.solved, 3);
});

// ── csv / formatters: null and non-array arms (lines 446, 479, 488-512) ──
test('csv: non-array input yields header-only output with BOM', () => {
  const csv = problemsToCsv(null);
  assert.ok(csv.startsWith('﻿id,name,status,'));
  assert.ok(!csv.includes('\n'));
});

test('csv: null/empty cell values escape to empty string', () => {
  const csv = problemsToCsv([{ id: 1, name: null, status: undefined }]);
  assert.ok(csv.includes('\n1,,'));
});

test('links/ids/markdown: non-array input returns empty string', () => {
  assert.equal(problemsToLinksText(null), '');
  assert.equal(problemsToIdsText(undefined), '');
  assert.equal(problemsToMarkdownText(42), '');
});

test('links: entries without string link are dropped', () => {
  assert.equal(problemsToLinksText([{ link: 123 }, { link: ' a ' }, null]), 'a');
});

test('ids: entries without finite id are dropped', () => {
  assert.equal(problemsToIdsText([{ id: 'x' }, { id: 2 }, {}]), '2');
});

test('markdown: id without name, and name without id, and missing link', () => {
  assert.equal(
    problemsToMarkdownText([
      { id: 5, link: 'L1' },
      { name: 'only-name', link: 'L2' },
      { id: 9, name: 'n' },
    ]),
    '- [#5](<L1>)\n- [only-name](<L2>)'
  );
});

// ── restoreProblemsFromSnapshot: defensive arms (lines 561-587) ──
test('restore: non-array problems -> empty; bad ids skipped; defaults applied', () => {
  const r1 = restoreProblemsFromSnapshot({ problems: 'nope' });
  assert.equal(r1.allProblems.length, 0);

  const r2 = restoreProblemsFromSnapshot({
    problems: [
      { id: 'bad' },
      { id: 7 },
      {
        id: 8,
        name: 12,
        link: null,
        difficulty: 'x',
        userScore: 'y',
        status: 'weird',
        postedBy_link: 1,
        postedBy_name: 2,
        postedBy_img: 3,
        author: 4,
        source: 5,
      },
    ],
    seenProblemIds: ['100', 'nan'],
  });
  assert.equal(r2.allProblems.length, 2);
  const p7 = r2.allProblems[0];
  assert.equal(p7.id, 7);
  assert.equal(p7.maxScore, 100);
  assert.equal(p7.userScore, null);
  assert.equal(p7.scoreKnown, false);
  assert.equal(p7.score, -1);
  assert.equal(p7.status, 'unattempted');
  const p8 = r2.allProblems[1];
  assert.equal(p8.name, '');
  assert.equal(p8.link, '');
  assert.equal(p8.difficulty, 3);
  assert.equal(p8.author, '');
  assert.equal(p8.source, '');
  assert.ok(r2.seenProblemIds.has(7));
  assert.ok(r2.seenProblemIds.has(8));
  assert.ok(r2.seenProblemIds.has(100));
});

test('restore: explicit valid status and known score are preserved', () => {
  const r = restoreProblemsFromSnapshot({
    problems: [{ id: 1, status: 'solved', userScore: 100, maxScore: 100, name: 'n', link: 'l' }],
  });
  const p = r.allProblems[0];
  assert.equal(p.status, 'solved');
  assert.equal(p.scoreKnown, true);
  assert.equal(p.score, 100);
});
