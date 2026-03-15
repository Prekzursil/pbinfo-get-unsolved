const { normalizeProblemQuality } = require('./quality');
const { classifyProblemStatus } = require('./score-parsing');

function readObjectRecord(value) {
  return value != null && typeof value === 'object' ? value : null;
}

function readArray(value) {
  return Array.isArray(value) ? value : [];
}

function readFiniteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function readFiniteOrFallback(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeSnapshotStorageLevel(source) {
  if (
    source?.storageLevel === 'full' ||
    source?.storageLevel === 'minimal' ||
    source?.storageLevel === 'progress'
  )
    return source.storageLevel;

  return Array.isArray(source?.problems) ? 'minimal' : 'progress';
}

function readSnapshotString(value) {
  return typeof value === 'string' ? value : '';
}

function isKnownProblemStatus(status) {
  return status === 'solved' || status === 'tried' || status === 'unattempted';
}

function readDeferredNumericValue(entry, tupleIndex, key) {
  const rawValue = Array.isArray(entry) ? entry[tupleIndex] : entry?.[key];
  return Number.parseInt(rawValue, 10);
}

function normalizeSnapshotStats(stats) {
  const source = readObjectRecord(stats) ?? {};

  return {
    solved: readFiniteOrFallback(source.solved, 0),
    tried: readFiniteOrFallback(source.tried, 0),
    unattempted: readFiniteOrFallback(source.unattempted, 0),
    total: readFiniteOrFallback(source.total, 0),
    pages: readFiniteOrFallback(source.pages, 0),
    missing: readFiniteOrFallback(source.missing, 0),
    forbidden: readFiniteOrFallback(source.forbidden, 0),
  };
}

function serializeProblemForSnapshot(problem, level) {
  const base = {
    id: problem?.id,
    name: problem?.name,
    link: problem?.link,
    difficulty: problem?.difficulty,
    status: problem?.status,
    quality: normalizeProblemQuality(problem?.quality),
    verifiedAt: Number.isFinite(problem?.verifiedAt) ? problem.verifiedAt : null,
    userScore: Number.isFinite(problem?.userScore) ? problem.userScore : null,
    maxScore: Number.isFinite(problem?.maxScore) ? problem.maxScore : null,
  };

  if (level === 'minimal') {
    return base;
  }

  return {
    ...base,
    postedBy_link: problem?.postedBy_link,
    postedBy_name: problem?.postedBy_name,
    postedBy_img: problem?.postedBy_img,
    author: problem?.author,
    source: problem?.source,
  };
}

function computeResumeFromStateSnapshot(snapshot) {
  const candidates = [];
  const pageQueue = readArray(snapshot?.pageQueue);
  const deferred = readArray(snapshot?.deferred);
  const inFlightPages = readArray(snapshot?.inFlightPages);
  let minimum = null;

  if (pageQueue.length > 0) {
    addCandidatePage(candidates, pageQueue[0]);
  }

  deferred.forEach(function (entry) {
    addCandidatePage(candidates, Array.isArray(entry) ? entry[0] : entry?.pageIndex);
  });

  inFlightPages.forEach(function (pageIndex) {
    addCandidatePage(candidates, pageIndex);
  });

  addCandidatePage(candidates, snapshot?.nextSequentialPage);

  if (candidates.length > 0) {
    minimum = Math.min(...candidates);
  }

  return readFiniteOrNull(minimum);
}

function addCandidatePage(candidates, pageIndex) {
  if (Number.isFinite(pageIndex)) {
    candidates.push(pageIndex);
  }
}

function resolveSnapshotStatus(problem, userScore, maxScore) {
  if (isKnownProblemStatus(problem?.status)) {
    return problem.status;
  }

  return classifyProblemStatus({ userScore, maxScore });
}

function buildRestoredProblem(problem, index, userScore, maxScore, status) {
  const scoreKnown = userScore != null;
  const restoredProblem = {};
  restoredProblem.cnt = index + 1;
  restoredProblem.id = problem.id;
  restoredProblem.name = readSnapshotString(problem.name);
  restoredProblem.link = readSnapshotString(problem.link);
  restoredProblem.difficulty = readFiniteOrFallback(problem.difficulty, 3);
  restoredProblem.score = scoreKnown ? userScore : -1;
  restoredProblem.scoreKnown = scoreKnown;
  restoredProblem.userScore = userScore;
  restoredProblem.maxScore = maxScore;
  restoredProblem.status = status;
  restoredProblem.quality = normalizeProblemQuality(problem.quality);
  restoredProblem.verifiedAt = readFiniteOrNull(problem.verifiedAt);
  restoredProblem.postedBy_link = readSnapshotString(problem.postedBy_link);
  restoredProblem.postedBy_name = readSnapshotString(problem.postedBy_name);
  restoredProblem.postedBy_img = readSnapshotString(problem.postedBy_img);
  restoredProblem.author = readSnapshotString(problem.author);
  restoredProblem.source = readSnapshotString(problem.source);
  return restoredProblem;
}

function restoreProblemFromSnapshotEntry(problem, index) {
  const source = readObjectRecord(problem);
  if (!source) {
    return null;
  }

  const id = readFiniteOrNull(source.id);
  const userScore = readFiniteOrNull(source.userScore);
  const maxScore = readFiniteOrFallback(source.maxScore, 100);

  if (id == null) {
    return null;
  }

  source.id = id;
  return buildRestoredProblem(
    source,
    index,
    userScore,
    maxScore,
    resolveSnapshotStatus(source, userScore, maxScore)
  );
}

function addSeenProblemId(seenProblemIds, value) {
  const id = Number.parseInt(value, 10);

  if (Number.isFinite(id)) {
    seenProblemIds.add(id);
  }
}

function restoreProblemsFromSnapshot(snapshot) {
  const allProblems = [];
  const seenProblemIds = new Set();
  const problems = readArray(snapshot?.problems);

  problems.forEach(function (problem, index) {
    const restored = restoreProblemFromSnapshotEntry(problem, index);

    if (!restored) {
      return;
    }

    allProblems.push(restored);
    seenProblemIds.add(restored.id);
  });

  readArray(snapshot?.seenProblemIds).forEach(function (value) {
    addSeenProblemId(seenProblemIds, value);
  });

  const restored = {};
  restored.allProblems = allProblems;
  restored.seenProblemIds = seenProblemIds;
  return restored;
}

function normalizeNumericArray(values) {
  return (Array.isArray(values) ? values : [])
    .map(function (value) {
      return Number.parseInt(value, 10);
    })
    .filter(Number.isFinite)
    .map(function (value) {
      return Math.trunc(value);
    });
}

function normalizeDeferredEntry(entry) {
  const pageIndex = readDeferredNumericValue(entry, 0, 'pageIndex');
  const retryCount = readDeferredNumericValue(entry, 1, 'retryCount');

  if (!Number.isFinite(pageIndex) || !Number.isFinite(retryCount)) {
    return null;
  }

  return [Math.trunc(pageIndex), Math.max(0, Math.trunc(retryCount))];
}

function normalizeSnapshotSavedAt(savedAt) {
  const numeric = Number(savedAt);
  return Number.isFinite(numeric) ? numeric : Date.now();
}

function ensureSnapshotProblems(output) {
  if (Array.isArray(output.problems)) {
    return;
  }

  output.problems = [];
}

function normalizeDeferredEntries(deferred) {
  return readArray(deferred).map(normalizeDeferredEntry).filter(Boolean);
}

function migrateStateSnapshotToV2(snapshot) {
  const source = readObjectRecord(snapshot);
  const output = source ? { ...source } : null;
  let storageLevel;

  if (!output) {
    return null;
  }

  storageLevel = normalizeSnapshotStorageLevel(source);
  output.version = 2;
  output.schemaVersion = 2;
  output.storageLevel = storageLevel;
  output.savedAt = normalizeSnapshotSavedAt(source.savedAt);
  output.pageQueue = normalizeNumericArray(source.pageQueue);
  output.deferred = normalizeDeferredEntries(source.deferred);
  output.inFlightPages = normalizeNumericArray(source.inFlightPages);
  output.seenProblemIds = normalizeNumericArray(source.seenProblemIds);
  output.stats = normalizeSnapshotStats(source.stats);
  ensureSnapshotProblems(output);

  if (!Number.isFinite(output.resumeFromPage)) {
    output.resumeFromPage = computeResumeFromStateSnapshot(output);
  }

  return output;
}

function isLikelySnapshotImportPayload(payload) {
  if (payload.version === 1 || payload.version === 2 || payload.schemaVersion === 2) {
    return true;
  }

  const listFields = ['problems', 'pageQueue', 'deferred', 'inFlightPages', 'seenProblemIds'];
  const hasListFields = listFields.some(function (field) {
    return Array.isArray(payload[field]);
  });
  if (hasListFields) {
    return true;
  }

  const hasStatsObject = payload.stats && typeof payload.stats === 'object';
  if (hasStatsObject) {
    return true;
  }

  return typeof payload.storageLevel === 'string';
}

function extractSnapshotFromImport(rawPayload) {
  const payload = readObjectRecord(rawPayload);

  if (!payload) {
    return null;
  }

  if (
    payload.type === 'pbinfo-get-unsolved-snapshot' &&
    payload.state &&
    typeof payload.state === 'object'
  ) {
    return migrateStateSnapshotToV2(payload.state);
  }

  if (!isLikelySnapshotImportPayload(payload)) {
    return null;
  }

  return migrateStateSnapshotToV2(payload);
}

module.exports = {
  serializeProblemForSnapshot,
  computeResumeFromStateSnapshot,
  restoreProblemFromSnapshotEntry,
  restoreProblemsFromSnapshot,
  migrateStateSnapshotToV2,
  extractSnapshotFromImport,
};
