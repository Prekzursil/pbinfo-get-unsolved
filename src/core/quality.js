const { normalizeForMatch } = require('./text-utils');

function normalizeProblemQuality(value) {
  const raw = normalizeForMatch(value || '');

  if (raw === 'verified') {
    return 'verified';
  }

  if (
    raw === 'verification-unknown' ||
    raw === 'verification_unknown' ||
    raw === 'verificationunknown'
  ) {
    return 'verification-unknown';
  }

  return 'scan-only';
}

function filterProblemsByQuality(problems, allowedQualities) {
  const list = Array.isArray(problems) ? problems : [];

  if (
    !(allowedQualities instanceof Set) ||
    allowedQualities.size === 0 ||
    allowedQualities.has('all')
  ) {
    return list;
  }

  return list.filter(function (problem) {
    return allowedQualities.has(normalizeProblemQuality(problem?.quality));
  });
}

module.exports = {
  normalizeProblemQuality,
  filterProblemsByQuality,
};
