const { normalizeSpace } = require('./text-utils');
const RANDOM_UINT32_DENOMINATOR = 2 ** 32;

function normalizeNavigationScope(scope) {
  return scope === 'all' ? 'all' : 'visible';
}

function isNavigationCandidate(problem) {
  return !!problem && problem.status !== 'solved';
}

function getNavigationCandidateIdentity(problem) {
  if (Number.isFinite(problem?.id)) {
    return String(problem.id);
  }

  return normalizeSpace(problem?.link || '');
}

function readNavigationCursor(navState, scope) {
  const cursor = navState?.cursors?.[scope];
  return Number.isFinite(cursor) ? cursor : -1;
}

function clampRandomUnit(rawValue) {
  if (!Number.isFinite(rawValue)) {
    return 0;
  }

  return Math.min(0.999999, Math.max(0, rawValue));
}

function readSecureRandomUnit() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const values = new Uint32Array(1);
    cryptoApi.getRandomValues(values);
    return values[0] / RANDOM_UINT32_DENOMINATOR;
  }

  return 0;
}

function createNavigationState() {
  return {
    cursors: { visible: -1, all: -1 },
    randomBags: { visible: [], all: [] },
    signatures: { visible: '', all: '' },
  };
}

function listNavigationCandidates(options) {
  const current = options && typeof options === 'object' ? options : {};
  const normalizedScope = normalizeNavigationScope(current.scope);
  const source = normalizedScope === 'all' ? current.allProblems : current.visibleProblems;

  return (Array.isArray(source) ? source : []).filter(function (problem) {
    return isNavigationCandidate(problem);
  });
}

function navigationCandidatesSignature(candidates) {
  return candidates
    .map(function (problem) {
      return getNavigationCandidateIdentity(problem);
    })
    .join(',');
}

function ensureNavigationStateContainers(navState) {
  if (!navState.signatures || typeof navState.signatures !== 'object') {
    navState.signatures = { visible: '', all: '' };
  }
  if (!navState.cursors || typeof navState.cursors !== 'object') {
    navState.cursors = { visible: -1, all: -1 };
  }
  if (!navState.randomBags || typeof navState.randomBags !== 'object') {
    navState.randomBags = { visible: [], all: [] };
  }
}

function resetNavigationScopeState(navState, normalizedScope, signature) {
  navState.signatures[normalizedScope] = signature;
  navState.cursors[normalizedScope] = -1;
  navState.randomBags[normalizedScope] = [];
}

function hasMatchingScopeSignature(navState, normalizedScope, signature) {
  if (!navState.signatures || typeof navState.signatures !== 'object') {
    return false;
  }
  return navState.signatures[normalizedScope] === signature;
}

function ensureNavigationStateScope(navState, scope, candidates) {
  if (!navState || typeof navState !== 'object') {
    return;
  }

  const normalizedScope = normalizeNavigationScope(scope);
  const signature = navigationCandidatesSignature(candidates);
  if (hasMatchingScopeSignature(navState, normalizedScope, signature)) {
    return;
  }

  ensureNavigationStateContainers(navState);
  resetNavigationScopeState(navState, normalizedScope, signature);
}

function pickNextNavigationProblem(navState, options) {
  const current = options && typeof options === 'object' ? options : {};
  const normalizedScope = normalizeNavigationScope(current.scope);
  const candidates = listNavigationCandidates({
    scope: normalizedScope,
    visibleProblems: current.visibleProblems,
    allProblems: current.allProblems,
  });
  const currentCursor = readNavigationCursor(navState, normalizedScope);
  let nextIndex;

  if (candidates.length === 0) {
    return null;
  }

  ensureNavigationStateScope(navState, normalizedScope, candidates);
  nextIndex = (currentCursor + 1) % candidates.length;
  navState.cursors[normalizedScope] = nextIndex;

  return candidates[nextIndex];
}

function pickRandomNavigationProblem(navState, options) {
  const current = options && typeof options === 'object' ? options : {};
  const normalizedScope = normalizeNavigationScope(current.scope);
  const candidates = listNavigationCandidates({
    scope: normalizedScope,
    visibleProblems: current.visibleProblems,
    allProblems: current.allProblems,
  });
  if (candidates.length === 0) {
    return null;
  }

  ensureNavigationStateScope(navState, normalizedScope, candidates);
  const bag = navState.randomBags[normalizedScope];

  if (!Array.isArray(bag) || bag.length === 0) {
    navState.randomBags[normalizedScope] = buildShuffledNavigationBag(candidates, current.rng);
  }

  return navState.randomBags[normalizedScope].shift() || null;
}

function buildShuffledNavigationBag(candidates, rng) {
  const bag = candidates.slice();
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const raw = typeof rng === 'function' ? rng() : readSecureRandomUnit();
    const clamped = clampRandomUnit(raw);
    const swapIndex = Math.floor(clamped * (i + 1));
    [bag[i], bag[swapIndex]] = [bag[swapIndex], bag[i]];
  }
  return bag;
}

module.exports = {
  listNavigationCandidates,
  createNavigationState,
  pickNextNavigationProblem,
  pickRandomNavigationProblem,
};
