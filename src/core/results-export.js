const { normalizeSpace } = require('./text-utils');
const { normalizeProblemQuality } = require('./quality');
const { classifyProblemStatus } = require('./score-parsing');

function readObjectRecord(value) {
  return value != null && typeof value === 'object' ? value : null;
}

function readString(value) {
  return typeof value === 'string' ? value : '';
}

function readFiniteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function cloneMetaSection(section) {
  return readObjectRecord(section) ? { ...section } : {};
}

function normalizeProblemStatus(status) {
  if (status === 'solved' || status === 'tried' || status === 'unattempted') {
    return status;
  }

  return 'unattempted';
}

function normalizeExportProblem(problem) {
  const source = readObjectRecord(problem) ?? {};

  return {
    id: source.id,
    name: readString(source.name),
    link: readString(source.link),
    status: normalizeProblemStatus(source.status),
    quality: normalizeProblemQuality(source.quality),
    verifiedAt: readFiniteOrNull(source.verifiedAt),
    userScore: readFiniteOrNull(source.userScore),
    maxScore: readFiniteOrNull(source.maxScore),
    difficulty: readFiniteOrNull(source.difficulty),
    postedBy_name: readString(source.postedBy_name),
    postedBy_link: readString(source.postedBy_link),
    author: readString(source.author),
    source: readString(source.source),
  };
}

function resolveNextMaxScore(scoreInfo, current) {
  if (Number.isFinite(scoreInfo?.maxScore)) {
    return scoreInfo.maxScore;
  }

  if (Number.isFinite(current.maxScore)) {
    return current.maxScore;
  }

  return 100;
}

function resolveVerificationStatus(previousStatus, nextStatus) {
  if (nextStatus === 'solved' && previousStatus !== 'solved') {
    return 'reclassified-solved';
  }

  return 'verified-unsolved';
}

function hasCsvReservedCharacters(text) {
  return text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r');
}

function escapeCsvQuotes(text) {
  return text.split('"').join('""');
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  const escaped = escapeCsvQuotes(text);

  if (hasCsvReservedCharacters(text)) {
    return '"' + escaped + '"';
  }

  return escaped;
}

function escapeMarkdownLinkText(text) {
  return normalizeSpace(text)
    .split('')
    .map(function (character) {
      return ['\\', '[', ']'].includes(character) ? '\\' + character : character;
    })
    .join('');
}

function buildMarkdownLabel(problem) {
  const id = readFiniteOrNull(problem?.id);
  const name = escapeMarkdownLinkText(readString(problem?.name));

  if (id == null) {
    return name;
  }

  if (name) {
    return '#' + id + ' - ' + name;
  }

  return '#' + id;
}

function problemsToCsv(problems) {
  const headers = [
    'id',
    'name',
    'status',
    'userScore',
    'maxScore',
    'difficulty',
    'postedBy',
    'author',
    'source',
    'link',
  ];
  const rows = Array.isArray(problems) ? problems : [];
  const lines = [headers.join(',')];

  for (const problem of rows) {
    const row = {
      id: problem.id,
      name: problem.name,
      status: problem.status,
      userScore: problem.userScore,
      maxScore: problem.maxScore,
      difficulty: problem.difficulty,
      postedBy: problem.postedBy_name,
      author: problem.author,
      source: problem.source,
      link: problem.link,
    };

    lines.push(
      headers
        .map(function (header) {
          return csvEscape(row[header]);
        })
        .join(',')
    );
  }

  return '\ufeff' + lines.join('\n');
}

function problemsToLinksText(problems) {
  return (Array.isArray(problems) ? problems : [])
    .map(function (problem) {
      return readString(problem?.link).trim();
    })
    .filter(Boolean)
    .join('\n');
}

function problemsToIdsText(problems) {
  return (Array.isArray(problems) ? problems : [])
    .map(function (problem) {
      return Number.isFinite(problem?.id) ? String(problem.id) : '';
    })
    .filter(Boolean)
    .join('\n');
}

function problemsToMarkdownText(problems) {
  return (Array.isArray(problems) ? problems : [])
    .map(function (problem) {
      const link = readString(problem?.link).trim();
      const label = buildMarkdownLabel(problem);

      if (link) {
        return '- [' + label + '](<' + link + '>)';
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function buildResultsExportPayload(problems, meta) {
  const currentMetaRecord = readObjectRecord(meta);
  const currentMeta = currentMetaRecord || {};
  const list = Array.isArray(problems) ? problems : [];
  const payload = Object.create(Object.prototype);

  payload.type = 'pbinfo-get-unsolved-results';
  payload.exportVersion = 1;
  payload.exportedAt = Date.now();
  payload.source = cloneMetaSection(currentMeta.source);
  payload.settings = cloneMetaSection(currentMeta.settings);
  payload.coverage = cloneMetaSection(currentMeta.coverage);
  payload.reliability = cloneMetaSection(currentMeta.reliability);
  payload.verification = cloneMetaSection(currentMeta.verification);
  payload.problems = list.map(function (problem) {
    return normalizeExportProblem(problem);
  });
  return payload;
}

function buildUnknownVerificationResult(current, previousStatus) {
  return {
    problem: {
      ...current,
      quality: 'verification-unknown',
    },
    previousStatus,
    nextStatus: previousStatus,
    verificationStatus: 'unknown',
  };
}

function buildVerifiedProblemResult(current, nextUserScore, nextMaxScore, previousStatus) {
  const nextStatus = classifyProblemStatus({
    userScore: nextUserScore,
    maxScore: nextMaxScore,
  });

  return {
    problem: {
      ...current,
      userScore: nextUserScore,
      maxScore: nextMaxScore,
      scoreKnown: true,
      score: nextUserScore,
      status: nextStatus,
      quality: 'verified',
    },
    previousStatus,
    nextStatus,
    verificationStatus: resolveVerificationStatus(previousStatus, nextStatus),
  };
}

function applyVerifiedScoreToProblem(problem, scoreInfo) {
  const current = readObjectRecord(problem) ? { ...problem } : {};
  const nextUserScore = readFiniteOrNull(scoreInfo?.userScore);
  const nextMaxScore = resolveNextMaxScore(scoreInfo, current);
  const previousStatus = normalizeProblemStatus(current.status);

  if (nextUserScore == null) {
    return buildUnknownVerificationResult(current, previousStatus);
  }

  return buildVerifiedProblemResult(current, nextUserScore, nextMaxScore, previousStatus);
}

module.exports = {
  problemsToCsv,
  problemsToLinksText,
  problemsToIdsText,
  problemsToMarkdownText,
  buildResultsExportPayload,
  applyVerifiedScoreToProblem,
};
