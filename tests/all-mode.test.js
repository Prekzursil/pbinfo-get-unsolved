const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeScanMode,
  resolveAllModeConfig,
  createAllModeProber,
  peekAllModeProbeId,
  applyAllModeProbeOutcome,
  finishAllModeProber,
  normalizeAllModeProberState,
  nextAllModeSweepTarget,
  classifyAllModeFetchOutcome,
  normalizeAllModeSkipList,
  isAllModeSkipEntry,
  computeAllModeDiff,
  formatAllModeDiffReport,
  collectAllModeCategoryIds,
  normalizeAllModeDiffState,
  normalizeAllModeSnapshotState,
  migrateStateSnapshotToV2,
} = require('../pbinfo-get-unsolved-enhanced.js');

// ── normalizeScanMode: every keyword arm of the three-mode dispatch ──
test('normalizeScanMode: numeric shortcuts', () => {
  assert.equal(normalizeScanMode('1'), 'list');
  assert.equal(normalizeScanMode('2'), 'id-range');
  assert.equal(normalizeScanMode('3'), 'all');
});

test('normalizeScanMode: "all" keyword arms (all / tot / complet)', () => {
  assert.equal(normalizeScanMode('all'), 'all');
  assert.equal(normalizeScanMode('totul'), 'all'); // 'tot' only, no 'all'
  assert.equal(normalizeScanMode('complet'), 'all'); // neither 'all' nor 'tot'
  assert.equal(normalizeScanMode('Totă scanarea'), 'all'); // diacritics + case
});

test('normalizeScanMode: id-range keyword arms (id / range / index)', () => {
  assert.equal(normalizeScanMode('id'), 'id-range');
  assert.equal(normalizeScanMode('dupa id'), 'id-range');
  assert.equal(normalizeScanMode('range'), 'id-range'); // no 'id'
  assert.equal(normalizeScanMode('index'), 'id-range'); // no 'id', no 'range'
});

test('normalizeScanMode: list arm and null fallbacks', () => {
  assert.equal(normalizeScanMode('lista'), 'list');
  assert.equal(normalizeScanMode('xyz'), null);
  assert.equal(normalizeScanMode(''), null);
  assert.equal(normalizeScanMode(null), null);
  assert.equal(normalizeScanMode(undefined), null);
});

// ── resolveAllModeConfig ──
test('resolveAllModeConfig: defaults for null/empty window', () => {
  const expected = { startId: 1, probeStep: 25, deadRun: 10, maxCeiling: 20000 };
  assert.deepEqual(resolveAllModeConfig(null), expected);
  assert.deepEqual(resolveAllModeConfig({}), expected);
  assert.deepEqual(resolveAllModeConfig('nope'), expected);
});

test('resolveAllModeConfig: finite values are truncated and clamped to >= 1', () => {
  assert.deepEqual(
    resolveAllModeConfig({
      PBINFO_GET_UNSOLVED_ALL_START: 3.9,
      PBINFO_GET_UNSOLVED_ALL_PROBE_STEP: 0,
      PBINFO_GET_UNSOLVED_ALL_DEAD_RUN: -4,
      PBINFO_GET_UNSOLVED_ALL_MAX_CEILING: 1e5 + 0.5,
    }),
    { startId: 3, probeStep: 1, deadRun: 1, maxCeiling: 100000 }
  );
});

test('resolveAllModeConfig: non-finite values fall back to defaults', () => {
  assert.deepEqual(
    resolveAllModeConfig({
      PBINFO_GET_UNSOLVED_ALL_START: 'abc',
      PBINFO_GET_UNSOLVED_ALL_PROBE_STEP: NaN,
      PBINFO_GET_UNSOLVED_ALL_DEAD_RUN: undefined,
      PBINFO_GET_UNSOLVED_ALL_MAX_CEILING: Infinity,
    }),
    { startId: 1, probeStep: 25, deadRun: 10, maxCeiling: 20000 }
  );
});

// ── createAllModeProber ──
test('createAllModeProber: defaults and option handling', () => {
  assert.deepEqual(createAllModeProber(), {
    phase: 'probe',
    lastLive: 0,
    probeStep: 25,
    deadRun: 10,
    maxCeiling: 20000,
    deadStreak: 0,
    done: false,
    ceiling: null,
    provenBy: null,
  });
  assert.deepEqual(createAllModeProber(null), createAllModeProber({}));
  const p = createAllModeProber({ startId: 5, probeStep: 10, deadRun: 3, maxCeiling: 99 });
  assert.equal(p.lastLive, 4);
  assert.equal(p.probeStep, 10);
  assert.equal(p.deadRun, 3);
  assert.equal(p.maxCeiling, 99);
});

// ── peekAllModeProbeId ──
test('peekAllModeProbeId: null for missing/done/invalid state', () => {
  assert.equal(peekAllModeProbeId(null), null);
  assert.equal(peekAllModeProbeId(undefined), null);
  assert.equal(peekAllModeProbeId('state'), null);
  assert.equal(peekAllModeProbeId({ done: true }), null);
});

test('peekAllModeProbeId: probe phase steps by probeStep, tail phase walks contiguously', () => {
  assert.equal(peekAllModeProbeId({ phase: 'probe', lastLive: 10, probeStep: 5 }), 15);
  assert.equal(
    peekAllModeProbeId({ phase: 'tail', lastLive: 10, probeStep: 5, deadStreak: 2 }),
    13
  );
});

test('peekAllModeProbeId: non-finite base and sub-1 ids yield null', () => {
  assert.equal(peekAllModeProbeId({ phase: 'probe', lastLive: NaN, probeStep: 5 }), null);
  assert.equal(
    peekAllModeProbeId({ phase: 'probe', lastLive: -1, probeStep: 1, deadStreak: 0 }),
    null
  );
});

// ── applyAllModeProbeOutcome ──
test('applyAllModeProbeOutcome: guards (no state, done, stale id)', () => {
  assert.equal(applyAllModeProbeOutcome(null, 5, 'live'), null);
  const doneState = createAllModeProber({ deadRun: 1 });
  const finished = { ...doneState, done: true, ceiling: 7 };
  assert.equal(applyAllModeProbeOutcome(finished, 9, 'live'), finished);
  const state = createAllModeProber({ startId: 10 });
  assert.equal(applyAllModeProbeOutcome(state, NaN, 'live'), state);
  assert.equal(applyAllModeProbeOutcome(state, 5, 'live'), state); // id <= lastLive(9)
});

test('applyAllModeProbeOutcome: live advances lastLive and resets tail streak', () => {
  const state = { ...createAllModeProber({ startId: 1 }), phase: 'tail', deadStreak: 4 };
  const next = applyAllModeProbeOutcome(state, 12, 'live');
  assert.equal(next.lastLive, 12);
  assert.equal(next.phase, 'probe');
  assert.equal(next.deadStreak, 0);
  assert.equal(next.done, false);
});

test('applyAllModeProbeOutcome: dead from probe phase enters tail with reset streak', () => {
  const state = createAllModeProber({ startId: 1, probeStep: 25 });
  const next = applyAllModeProbeOutcome(state, 26, 'dead'); // probe-phase dead
  assert.equal(next.phase, 'tail');
  assert.equal(next.deadStreak, 0);
  assert.equal(next.lastLive, 0);
  // Tail then probes lastLive + 1 = 1, not 26.
  assert.equal(peekAllModeProbeId(next), 1);
});

test('applyAllModeProbeOutcome: non-contiguous tail dead restarts the tail honestly', () => {
  const state = { ...createAllModeProber({ startId: 1 }), phase: 'tail', deadStreak: 2 };
  // Contiguous next would be lastLive+1+2 = 3; a dead at 7 is out of order.
  const next = applyAllModeProbeOutcome(state, 7, 'dead');
  assert.equal(next.phase, 'tail');
  assert.equal(next.deadStreak, 0);
  assert.equal(next.lastLive, 0);
});

test('applyAllModeProbeOutcome: contiguous tail deads build the streak and prove the ceiling', () => {
  const state = {
    ...createAllModeProber({ startId: 1, deadRun: 3 }),
    phase: 'tail',
    deadStreak: 0,
  };
  const after1 = applyAllModeProbeOutcome(state, 1, 'dead'); // lastLive 0, streak 1
  assert.equal(after1.deadStreak, 1);
  assert.equal(after1.done, false);
  const after2 = applyAllModeProbeOutcome(after1, 2, 'dead'); // streak 2
  assert.equal(after2.deadStreak, 2);
  assert.equal(after2.done, false);
  const after3 = applyAllModeProbeOutcome(after2, 3, 'dead'); // streak 3 = deadRun
  assert.equal(after3.done, true);
  assert.equal(after3.ceiling, 0);
  assert.equal(after3.provenBy, 'dead-run');
});

// ── finishAllModeProber ──
test('finishAllModeProber: clamps ceiling and normalizes provenBy', () => {
  const state = createAllModeProber({});
  const a = finishAllModeProber(state, 5.9, 'max-ceiling');
  assert.equal(a.done, true);
  assert.equal(a.ceiling, 5);
  assert.equal(a.provenBy, 'max-ceiling');
  const b = finishAllModeProber(state, 0, '');
  assert.equal(b.ceiling, 1);
  assert.equal(b.provenBy, null);
  const c = finishAllModeProber(state, NaN, 'whatever');
  assert.equal(c.ceiling, null);
  assert.equal(c.provenBy, 'whatever');
});

// ── normalizeAllModeProberState ──
test('normalizeAllModeProberState: invalid raw becomes a fresh default prober', () => {
  assert.deepEqual(normalizeAllModeProberState(null), createAllModeProber({}));
  assert.deepEqual(normalizeAllModeProberState('x'), createAllModeProber({}));
});

test('normalizeAllModeProberState: preserves valid fields, repairs invalid ones', () => {
  const good = normalizeAllModeProberState({
    phase: 'tail',
    lastLive: 41,
    probeStep: 12,
    deadRun: 4,
    maxCeiling: 500,
    deadStreak: 2,
    done: true,
    ceiling: 41,
    provenBy: 'dead-run',
  });
  assert.equal(good.phase, 'tail');
  assert.equal(good.lastLive, 41);
  assert.equal(good.probeStep, 12);
  assert.equal(good.deadRun, 4);
  assert.equal(good.maxCeiling, 500);
  assert.equal(good.deadStreak, 2);
  assert.equal(good.done, true);
  assert.equal(good.ceiling, 41);
  assert.equal(good.provenBy, 'dead-run');

  const patched = normalizeAllModeProberState({
    phase: 'weird', // -> 'probe'
    lastLive: NaN, // -> 0 (and startId fallback 1)
    deadStreak: NaN, // -> 0
    done: 'yes', // -> false (not strictly true)
    ceiling: 'x', // -> null
    provenBy: '', // -> null
  });
  assert.equal(patched.phase, 'probe');
  assert.equal(patched.lastLive, 0);
  assert.equal(patched.deadStreak, 0);
  assert.equal(patched.done, false);
  assert.equal(patched.ceiling, null);
  assert.equal(patched.provenBy, null);
  assert.equal(patched.probeStep, 25); // defaults preserved
});

// ── nextAllModeSweepTarget ──
test('nextAllModeSweepTarget: bound handling for known/unknown ceilings', () => {
  assert.equal(nextAllModeSweepTarget(5, null), 5); // no ceiling yet
  assert.equal(nextAllModeSweepTarget(5, 'NaN-as-string'), 5); // non-finite ceiling ignored
  assert.equal(nextAllModeSweepTarget(5, 10), 5); // within ceiling
  assert.equal(nextAllModeSweepTarget(11, 10), null); // past ceiling
  assert.equal(nextAllModeSweepTarget(NaN, 10), null); // invalid cursor
  assert.equal(nextAllModeSweepTarget(0, 10), null); // cursor < 1
});

// ── classifyAllModeFetchOutcome ──
test('classifyAllModeFetchOutcome: every distinct kind', () => {
  assert.deepEqual(classifyAllModeFetchOutcome({ status: 200, blocked: true }), {
    kind: 'transient',
    reason: 'blocked',
  });
  assert.deepEqual(classifyAllModeFetchOutcome({ status: 404 }), {
    kind: 'dead',
    reason: 'not-found',
  });
  assert.deepEqual(classifyAllModeFetchOutcome({ status: 200, notFound: true }), {
    kind: 'dead',
    reason: 'not-found',
  });
  assert.deepEqual(classifyAllModeFetchOutcome({ status: 401 }), {
    kind: 'cookie-shell',
    reason: 'forbidden',
  });
  assert.deepEqual(classifyAllModeFetchOutcome({ status: 403 }), {
    kind: 'cookie-shell',
    reason: 'forbidden',
  });
  assert.deepEqual(classifyAllModeFetchOutcome({ status: 500 }), {
    kind: 'transient',
    reason: 'http-500',
  });
  assert.deepEqual(classifyAllModeFetchOutcome({ status: 200, hasProblemShell: false }), {
    kind: 'cookie-shell',
    reason: 'no-problem-shell',
  });
  assert.deepEqual(classifyAllModeFetchOutcome({ status: 200, hasProblemShell: true }), {
    kind: 'live',
    reason: null,
  });
});

test('classifyAllModeFetchOutcome: missing status is treated as a transient http error', () => {
  assert.deepEqual(classifyAllModeFetchOutcome({}), { kind: 'transient', reason: 'http-0' });
  assert.deepEqual(classifyAllModeFetchOutcome(), { kind: 'transient', reason: 'http-0' });
});

// ── normalizeAllModeSkipList ──
test('normalizeAllModeSkipList: non-array input yields empty list', () => {
  assert.deepEqual(normalizeAllModeSkipList(null), []);
  assert.deepEqual(normalizeAllModeSkipList('x'), []);
});

test('normalizeAllModeSkipList: filters invalid entries, repairs fields, sorts by id', () => {
  const out = normalizeAllModeSkipList([
    { id: 9, kind: 'dead', reason: 'not-found', attempts: 2 },
    { id: 'x', kind: 'dead' }, // invalid id -> dropped
    { id: 2, kind: 'unknown-kind' }, // invalid kind -> dropped
    { id: 4, kind: 'cookie-shell', reason: 7, attempts: NaN }, // reason coerced, attempts -> 0
    { id: 0, kind: 'transient' }, // id < 1 -> dropped
    { id: 1, kind: 'transient', reason: 'blocked' }, // missing attempts -> 0
  ]);
  assert.deepEqual(out, [
    { id: 1, kind: 'transient', reason: 'blocked', attempts: 0 },
    { id: 4, kind: 'cookie-shell', reason: '', attempts: 0 },
    { id: 9, kind: 'dead', reason: 'not-found', attempts: 2 },
  ]);
});

// ── isAllModeSkipEntry ──
test('isAllModeSkipEntry: only non-transient entries permanently skip an ID', () => {
  assert.equal(isAllModeSkipEntry(null), false);
  assert.equal(isAllModeSkipEntry(undefined), false);
  assert.equal(isAllModeSkipEntry('dead'), false);
  assert.equal(isAllModeSkipEntry({ kind: 'transient', reason: 'blocked' }), false);
  assert.equal(isAllModeSkipEntry({ kind: 'dead', reason: 'not-found' }), true);
  assert.equal(isAllModeSkipEntry({ kind: 'cookie-shell', reason: 'forbidden' }), true);
});

// ── computeAllModeDiff ──
test('computeAllModeDiff: hidden vs missing with sanitised inputs', () => {
  const diff = computeAllModeDiff(
    [3, '7', 3, NaN, 0, 12], // dupes + junk filtered
    [3, 7, 99]
  );
  assert.equal(diff.sweepTotal, 3); // 3, 7, 12
  assert.equal(diff.categoryTotal, 3); // 3, 7, 99
  assert.deepEqual(diff.hiddenIds, [12]); // only in sweep
  assert.deepEqual(diff.missingFromSweepIds, [99]); // only in category inventory
  assert.equal(diff.hiddenCount, 1);
  assert.equal(diff.missingFromSweepCount, 1);
  assert.equal(diff.sweepStartId, 3);
});

test('computeAllModeDiff: non-array inputs and empty sweep', () => {
  assert.deepEqual(computeAllModeDiff(null, null), {
    sweepStartId: null,
    sweepTotal: 0,
    categoryTotal: 0,
    hiddenIds: [],
    missingFromSweepIds: [],
    hiddenCount: 0,
    missingFromSweepCount: 0,
  });
  const onlyCategory = computeAllModeDiff([], [5]);
  assert.deepEqual(onlyCategory.missingFromSweepIds, [5]);
  assert.equal(onlyCategory.sweepStartId, null);
});

test('computeAllModeDiff: unordered multi-ID sweeps sort and report start ID', () => {
  const diff = computeAllModeDiff([9, 2, 5], []);
  assert.equal(diff.sweepStartId, 2);
  assert.deepEqual(diff.hiddenIds, [2, 5, 9]); // sorted
  assert.deepEqual(diff.missingFromSweepIds, []);

  const withMissing = computeAllModeDiff([1], [9, 4, 1]);
  assert.deepEqual(withMissing.missingFromSweepIds, [4, 9]); // sorted
  assert.deepEqual(withMissing.hiddenIds, []);
});

// ── formatAllModeDiffReport ──
test('formatAllModeDiffReport: full rendering', () => {
  const text = formatAllModeDiffReport(
    computeAllModeDiff([1, 2, 6], [2, 9]) // sweep starts at 1 -> no start note
  );
  assert.ok(text.includes('Total scanare completă: 3 · total inventar categorii: 2'));
  assert.ok(text.includes('DOAR de scanarea completă (ascunse/fără categorie): 2'));
  assert.ok(text.includes('IDs: 1, 6'));
  assert.ok(text.includes('Probleme din inventar lipsă din scanarea completă: 1'));
  assert.ok(text.includes('IDs: 9'));
  assert.ok(!text.includes('a început de la ID'));
});

test('formatAllModeDiffReport: empty lists and missing/invalid diff fields', () => {
  const empty = formatAllModeDiffReport(computeAllModeDiff([], []));
  assert.ok(empty.includes('(niciunul)'));
  const fromNull = formatAllModeDiffReport(null);
  assert.ok(fromNull.includes('Total scanare completă: 0'));
  assert.ok(fromNull.includes('(niciunul)'));
  const patchy = formatAllModeDiffReport({ sweepTotal: 'x', categoryTotal: 4, hiddenIds: null });
  assert.ok(patchy.includes('Total scanare completă: 0 · total inventar categorii: 4'));
});

test('formatAllModeDiffReport: start note when sweep began past ID 1', () => {
  const text = formatAllModeDiffReport(computeAllModeDiff([500], [2]));
  assert.ok(text.includes('Scanarea completă a început de la ID 500'));
  assert.ok(text.includes('IDs: 2'));
});

test('formatAllModeDiffReport: long ID lists are truncated at 200 entries', () => {
  const ids = [];
  for (let i = 1; i <= 201; i++) ids.push(i * 2);
  const text = formatAllModeDiffReport({
    sweepStartId: 1,
    sweepTotal: 201,
    categoryTotal: 0,
    hiddenIds: ids,
    missingFromSweepIds: [],
  });
  assert.ok(text.includes(`(+1 altele)`));
  assert.ok(text.includes('400'));
});

// ── collectAllModeCategoryIds ──
test('collectAllModeCategoryIds: unions list-mode snapshots only', () => {
  const ids = collectAllModeCategoryIds([
    null, // skipped
    'nope', // skipped
    { scanMode: 'id-range', problems: [{ id: 777 }] }, // not list mode
    { scanMode: 'all', problems: [{ id: 888 }] }, // not list mode
    { scanMode: 'list' }, // no problems array
    { scanMode: 'list', problems: null },
    { scanMode: 'list', problems: [{ id: 5 }, { id: '9' }, { id: 'x' }, { id: 0 }, null] },
    { scanMode: 'list', problems: [{ id: 5 }] }, // dedup
  ]);
  assert.deepEqual(ids, [5, 9]);
});

test('collectAllModeCategoryIds: non-array states input', () => {
  assert.deepEqual(collectAllModeCategoryIds(null), []);
  assert.deepEqual(collectAllModeCategoryIds('x'), []);
});

// ── normalizeAllModeDiffState ──
test('normalizeAllModeDiffState: null passthrough and repair', () => {
  assert.equal(normalizeAllModeDiffState(null), null);
  assert.equal(normalizeAllModeDiffState('x'), null);

  const empty = normalizeAllModeDiffState({});
  assert.deepEqual(empty, {
    sweepStartId: null,
    sweepTotal: 0,
    categoryTotal: 0,
    hiddenIds: [],
    missingFromSweepIds: [],
    hiddenCount: 0,
    missingFromSweepCount: 0,
  });

  const repaired = normalizeAllModeDiffState({
    sweepStartId: 'x',
    sweepTotal: -3,
    categoryTotal: '7',
    hiddenIds: [4, 'x', 2, 0],
    missingFromSweepIds: null,
  });
  assert.deepEqual(repaired.hiddenIds, [2, 4]);
  assert.deepEqual(repaired.missingFromSweepIds, []);
  assert.equal(repaired.sweepStartId, null);
  assert.equal(repaired.sweepTotal, 0);
  assert.equal(repaired.categoryTotal, 7);
  assert.equal(repaired.hiddenCount, 2);
  assert.equal(repaired.missingFromSweepCount, 0);

  const kept = normalizeAllModeDiffState({ sweepStartId: 6.8 });
  assert.equal(kept.sweepStartId, 6);
});

// ── normalizeAllModeSnapshotState ──
test('normalizeAllModeSnapshotState: null for missing/invalid raw', () => {
  assert.equal(normalizeAllModeSnapshotState(null), null);
  assert.equal(normalizeAllModeSnapshotState(undefined), null);
  assert.equal(normalizeAllModeSnapshotState(42), null);
});

test('normalizeAllModeSnapshotState: defaults for an empty object', () => {
  const out = normalizeAllModeSnapshotState({});
  assert.equal(out.ceiling, null);
  assert.equal(out.sweepCursor, 1);
  assert.deepEqual(out.pendingSweepIds, []);
  assert.deepEqual(out.skipList, []);
  assert.equal(out.diff, null);
  assert.deepEqual(out.prober, createAllModeProber({}));
});

test('normalizeAllModeSnapshotState: full roundtrip normalisation', () => {
  const out = normalizeAllModeSnapshotState({
    ceiling: 123.9,
    sweepCursor: '8',
    pendingSweepIds: [6, 'bad', 7, 0],
    skipList: normalizeAllModeSkipList([{ id: 3, kind: 'dead', reason: 'not-found' }]),
    prober: { phase: 'tail', lastLive: 120, deadRun: 5 },
    diff: { sweepTotal: 10, categoryTotal: 9, hiddenIds: [11], missingFromSweepIds: [] },
  });
  assert.equal(out.ceiling, 123);
  assert.equal(out.sweepCursor, 8);
  assert.deepEqual(out.pendingSweepIds, [6, 7]);
  assert.equal(out.skipList.length, 1);
  assert.equal(out.prober.phase, 'tail');
  assert.equal(out.prober.lastLive, 120);
  assert.equal(out.prober.deadRun, 5);
  assert.equal(out.diff.hiddenCount, 1);
  assert.equal(out.diff.sweepStartId, null);
});

// ── migrateStateSnapshotToV2: the allMode arm ──
test('migrateStateSnapshotToV2: attaches normalised allMode state', () => {
  const migrated = migrateStateSnapshotToV2({
    pageLink: 'all:https://www.pbinfo.ro',
    allMode: { ceiling: 90, sweepCursor: 45, skipList: [{ id: 3, kind: 'dead' }] },
  });
  assert.equal(migrated.allMode.ceiling, 90);
  assert.equal(migrated.allMode.sweepCursor, 45);
  assert.deepEqual(migrated.allMode.skipList, [{ id: 3, kind: 'dead', reason: '', attempts: 0 }]);
});

test('migrateStateSnapshotToV2: allMode is null when absent or invalid', () => {
  assert.equal(migrateStateSnapshotToV2({}).allMode, null);
  assert.equal(migrateStateSnapshotToV2({ allMode: 'corrupt' }).allMode, null);
});

// ── integration: prober walk proves the ceiling end-to-end ──
test('prober integration: forward probes, tail verification, ceiling proof', () => {
  const state0 = createAllModeProber({ startId: 1, probeStep: 25, deadRun: 3, maxCeiling: 1000 });
  // Live probes advance the frontier by the step.
  const s1 = applyAllModeProbeOutcome(state0, 26, 'live');
  const s2 = applyAllModeProbeOutcome(s1, 51, 'live');
  assert.equal(peekAllModeProbeId(s2), 76);
  // Probe at 76 dies -> enter tail; verify 52, 53, 54 all dead -> ceiling 51.
  const s3 = applyAllModeProbeOutcome(s2, 76, 'dead');
  assert.equal(peekAllModeProbeId(s3), 52);
  const s4 = applyAllModeProbeOutcome(s3, 52, 'dead');
  assert.equal(s4.deadStreak, 1);
  const s5 = applyAllModeProbeOutcome(s4, 53, 'dead');
  assert.equal(s5.deadStreak, 2);
  assert.equal(s5.done, false);
  const s6 = applyAllModeProbeOutcome(s5, 54, 'dead');
  assert.equal(s6.done, true);
  assert.equal(s6.ceiling, 51);
  assert.equal(s6.provenBy, 'dead-run');
  // Done: no further probe targets.
  assert.equal(peekAllModeProbeId(s6), null);
  // Sweep target stops at the ceiling.
  assert.equal(nextAllModeSweepTarget(51, 51), 51);
  assert.equal(nextAllModeSweepTarget(52, 51), null);
});

test('prober integration: sweep live results also advance the prober', () => {
  const state = createAllModeProber({ startId: 1, probeStep: 25, deadRun: 2 });
  // Sweep captures id 40 live (no probe there); prober follows along.
  const s1 = applyAllModeProbeOutcome(state, 40, 'live');
  assert.equal(s1.lastLive, 40);
  assert.equal(peekAllModeProbeId(s1), 65);
  // A stale sweep result below lastLive is a no-op.
  assert.equal(applyAllModeProbeOutcome(s1, 30, 'live'), s1);
});
