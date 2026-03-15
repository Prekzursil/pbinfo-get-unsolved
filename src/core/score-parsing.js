const { normalizeSpace, normalizeForMatch } = require('./text-utils');

const TOOLTIP_ATTRIBUTES = [
  'title',
  'data-bs-title',
  'data-bs-original-title',
  'data-original-title',
];
const USER_HINTS = ['obtinut', 'realizat', 'utilizator', 'user', 'tau'];
const MAX_HINTS = ['maxim', 'max'];
const SCORE_LABELS = ['punctaj', 'scor', 'score'];

function queryAll(root, selector) {
  return Array.from(root?.querySelectorAll?.(selector) || []);
}

function queryOne(root, selector) {
  return root?.querySelector?.(selector) || null;
}

function includesScoreLabel(text) {
  return SCORE_LABELS.some(function (label) {
    return text.includes(label);
  });
}

function buildScoreCandidate(element, parsed, text) {
  return {
    el: element,
    tooltip: getTooltipText(element),
    text: text,
    value: parsed.value,
    max: parsed.max,
    hasRatio: parsed.hasRatio,
    isLink: element?.tagName === 'A',
  };
}

function parseScoreText(text) {
  const normalizedText = normalizeSpace(text);
  let match;

  if (!normalizedText) {
    return null;
  }

  match = /(\d{1,3})\s*\/\s*(\d{1,3})/.exec(normalizedText);
  if (match) {
    return {
      value: Number.parseInt(match[1], 10),
      max: Number.parseInt(match[2], 10),
      hasRatio: true,
    };
  }

  match = /(\d{1,3})\s*%/.exec(normalizedText);
  if (match) {
    return {
      value: Number.parseInt(match[1], 10),
      max: 100,
      hasRatio: false,
    };
  }

  match = /(\d{1,3})/.exec(normalizedText);
  if (!match) {
    return null;
  }

  return {
    value: Number.parseInt(match[1], 10),
    max: null,
    hasRatio: false,
  };
}

function getTooltipText(element) {
  let index;
  let value;

  for (index = 0; index < TOOLTIP_ATTRIBUTES.length; index += 1) {
    value = element?.getAttribute?.(TOOLTIP_ATTRIBUTES[index]) || null;
    if (value) {
      return value;
    }
  }

  return '';
}

function isUserCandidate(candidate) {
  const text = normalizeForMatch(candidate.tooltip) + ' ' + normalizeForMatch(candidate.text);

  return USER_HINTS.some(function (hint) {
    return text.includes(hint);
  });
}

function isMaxPointsCandidate(candidate) {
  const text = normalizeForMatch(candidate.tooltip) + ' ' + normalizeForMatch(candidate.text);
  const hasMaxHint = MAX_HINTS.some(function (hint) {
    return text.includes(hint);
  });
  const hasScoreWord = includesScoreLabel(text);

  if (isUserCandidate(candidate)) {
    return false;
  }

  if (text.includes('punctaj maxim') || text.includes('scor maxim')) {
    return true;
  }

  return hasMaxHint && hasScoreWord;
}

function rankScoreCandidate(candidate) {
  let rank = 0;

  if (isUserCandidate(candidate)) {
    rank += 100;
  }
  if (candidate.hasRatio) {
    rank += 50;
  }
  if (candidate.isLink) {
    rank += 10;
  }

  return rank;
}

function collectNonMaxCandidates(candidates) {
  const nonMaxCandidates = [];
  let maxScore = null;

  candidates.forEach(function (candidate) {
    if (isMaxPointsCandidate(candidate)) {
      if (Number.isFinite(candidate.value) && maxScore === null) {
        maxScore = candidate.value;
      }
      return;
    }
    nonMaxCandidates.push(candidate);
  });

  return { nonMaxCandidates: nonMaxCandidates, maxScore: maxScore };
}

function pickHighestRankedCandidate(candidates) {
  const rankedCandidates = candidates
    .map(function (candidate) {
      return { candidate: candidate, rank: rankScoreCandidate(candidate) };
    })
    .sort(function (left, right) {
      return right.rank - left.rank;
    });

  for (const entry of rankedCandidates) {
    if (Number.isFinite(entry?.candidate?.value)) {
      return entry.candidate;
    }
  }
  return null;
}

function buildUnknownUserScoreResult(maxScore) {
  return { userScore: null, maxScore: maxScore };
}

function shouldTreatCandidateAsImplicitMax(bestCandidate, candidates, maxScore) {
  return (
    !isUserCandidate(bestCandidate) &&
    !bestCandidate.hasRatio &&
    candidates.length === 1 &&
    bestCandidate.value === 100 &&
    maxScore === null
  );
}

function resolveSelectedCandidateMaxScore(bestCandidate, maxScore) {
  if (bestCandidate.max != null && Number.isFinite(bestCandidate.max)) {
    return bestCandidate.max;
  }
  return maxScore;
}

function selectScoreFromCandidates(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const collected = collectNonMaxCandidates(list);
  const nonMaxCandidates = collected.nonMaxCandidates;
  let maxScore = collected.maxScore;

  if (nonMaxCandidates.length === 0) {
    return buildUnknownUserScoreResult(maxScore);
  }

  const best = pickHighestRankedCandidate(nonMaxCandidates);

  if (!best) {
    return buildUnknownUserScoreResult(maxScore);
  }

  if (shouldTreatCandidateAsImplicitMax(best, list, maxScore)) {
    return buildUnknownUserScoreResult(100);
  }

  maxScore = resolveSelectedCandidateMaxScore(best, maxScore);

  return { userScore: best.value, maxScore: maxScore };
}

function hasResolvableBadgeScoreContext({
  parsed,
  text,
  hasScoreTooltip,
  withinFooter,
  withinSolveButton,
}) {
  const looksLikeScoreText = /\bp\b/i.test(text) || Boolean(parsed?.hasRatio);
  if (looksLikeScoreText || hasScoreTooltip) {
    return true;
  }
  return withinFooter || withinSolveButton;
}

function buildBadgeScoreCandidate(element, seenElements) {
  const text = normalizeSpace(element.textContent);
  const parsed = parseScoreText(text);
  const tooltipText = normalizeForMatch(getTooltipText(element));
  const withinFooter = Boolean(element.closest('div.card-footer'));
  const button = element.closest('a.btn');
  const withinSolveButton = normalizeForMatch(button ? button.textContent : '').includes('rezolv');
  const hasScoreTooltip = includesScoreLabel(tooltipText);

  if (!parsed) {
    return null;
  }
  if (
    !hasResolvableBadgeScoreContext({
      parsed,
      text,
      hasScoreTooltip,
      withinFooter,
      withinSolveButton,
    })
  ) {
    return null;
  }
  if (seenElements.has(element)) {
    return null;
  }

  return { candidate: buildScoreCandidate(element, parsed, text), element: element };
}

function buildScoreCandidatesFromCard(card) {
  const candidates = [];
  const seenElements = new Set();
  const tooltipElements = queryAll(
    card,
    '[title],[data-bs-title],[data-bs-original-title],[data-original-title]'
  );

  tooltipElements.forEach(function (element) {
    const rawTooltip = getTooltipText(element);
    const tooltip = normalizeForMatch(rawTooltip);
    const text = normalizeSpace(element.textContent);
    const parsed = parseScoreText(text) || parseScoreText(rawTooltip);

    if (!tooltip) {
      return;
    }

    if (!includesScoreLabel(tooltip)) {
      return;
    }

    if (!parsed) {
      return;
    }

    seenElements.add(element);
    candidates.push(buildScoreCandidate(element, parsed, text));
  });

  queryAll(card, 'span.badge, a.badge, div.badge')
    .filter(function (element) {
      return !normalizeSpace(element.textContent).startsWith('#');
    })
    .forEach(function (element) {
      const result = buildBadgeScoreCandidate(element, seenElements);
      if (!result) {
        return;
      }
      seenElements.add(result.element);
      candidates.push(result.candidate);
    });

  return candidates;
}

function extractScoreInfoFromCard(card) {
  const candidates = buildScoreCandidatesFromCard(card);
  const selected = selectScoreFromCandidates(candidates);

  return {
    userScore: selected.userScore,
    maxScore: selected.maxScore,
    candidates: candidates,
  };
}

function extractScoreInfoFromProblemPage(root) {
  const candidates = [];
  const cell = queryOne(root, '#scor_utilizator_problema');
  const preferred = cell
    ? cell.querySelector('a.badge, span.badge, a, span, div') || cell.firstElementChild || cell
    : null;
  const text = preferred ? normalizeSpace(preferred.textContent) : '';
  const tooltip = preferred ? getTooltipText(preferred) || getTooltipText(cell) : '';
  const parsed = parseScoreText(text) || parseScoreText(tooltip);

  if (!cell) {
    return { userScore: null, maxScore: null, candidates: candidates };
  }

  if (parsed) {
    candidates.push({
      el: preferred,
      tooltip: tooltip,
      text: text,
      value: parsed.value,
      max: parsed.max,
      hasRatio: parsed.hasRatio,
    });
  }

  return {
    userScore: Number.isFinite(parsed?.value) ? parsed.value : null,
    maxScore: Number.isFinite(parsed?.max) ? parsed.max : null,
    candidates: candidates,
  };
}

function buildProblemRowMeta(root) {
  const scoreCell = queryOne(root, '#scor_utilizator_problema');
  const row = scoreCell?.closest?.('tr') || null;
  const tds = row ? Array.from(row.querySelectorAll('td')) : [];
  const scoreIndex = scoreCell ? tds.indexOf(scoreCell) : -1;

  return {
    scoreCell,
    difficultyCell: scoreIndex > 0 ? tds[scoreIndex - 1] : null,
    authorCell: scoreIndex > 1 ? tds[scoreIndex - 2] : null,
    sourceCell: scoreIndex > 2 ? tds[scoreIndex - 3] : null,
    postedByCell: tds.length > 0 ? tds[0] : null,
  };
}

function readProblemTitle(root, heading) {
  const headingTitle = heading ? normalizeSpace(heading.textContent) : '';
  if (headingTitle) {
    return headingTitle;
  }

  return normalizeSpace(
    queryOne(root, 'meta[property="og:title"]')?.getAttribute?.('content') ||
      queryOne(root, 'title')?.textContent ||
      ''
  );
}

function normalizeProblemName(titleText, problemId) {
  if (!titleText) {
    return '';
  }

  return stripProblemIdPrefix(titleText.replace(/- pbinfo\.ro.*$/i, '').trim(), problemId)
    .replace(/^[-–—:]\s*/, '')
    .trim();
}

function resolveDifficultyValue(difficultyCell) {
  const difficultyText = difficultyCell ? normalizeForMatch(difficultyCell.textContent) : '';
  if (difficultyText.includes('uso')) return 0;
  if (difficultyText.includes('med')) return 1;
  if (difficultyText.includes('dific')) return 2;
  return 3;
}

function applyProblemMetaAuthorAndSource(meta, rowMeta) {
  if (rowMeta.authorCell) {
    meta.author = normalizeSpace(rowMeta.authorCell.textContent);
    if (meta.author === '-') {
      meta.author = '';
    }
  }

  if (rowMeta.sourceCell) {
    meta.source = normalizeSpace(rowMeta.sourceCell.textContent);
    if (meta.source === '-') {
      meta.source = '';
    }
  }
}

function applyProblemMetaPostedBy(meta, postedByAnchor) {
  if (!postedByAnchor) {
    return;
  }

  meta.postedBy_link = postedByAnchor.href || '';
  meta.postedBy_name = normalizeSpace(postedByAnchor.textContent);
  if (postedByAnchor.querySelector('img')?.src) {
    meta.postedBy_img = postedByAnchor.querySelector('img').src;
  }
}

function extractProblemMetaFromProblemPage(root, problemId) {
  const meta = {
    name: '',
    difficulty: 3,
    postedBy_link: '',
    postedBy_name: '',
    postedBy_img: '',
    author: '',
    source: '',
  };
  const heading = queryOne(root, 'h1') || queryOne(root, 'h2');
  const rowMeta = buildProblemRowMeta(root);
  const postedByAnchor = queryOne(rowMeta.postedByCell, 'a');
  const titleText = readProblemTitle(root, heading);

  meta.name = normalizeProblemName(titleText, problemId);
  meta.difficulty = resolveDifficultyValue(rowMeta.difficultyCell);
  applyProblemMetaAuthorAndSource(meta, rowMeta);
  applyProblemMetaPostedBy(meta, postedByAnchor);

  return meta;
}

function skipProblemIdPrefixMarkers(title) {
  let index = 0;

  while (index < title.length && (title[index] === '#' || /\s/.test(title[index]))) {
    index += 1;
  }

  return index;
}

function isWordCharacter(value) {
  if (!value) {
    return false;
  }

  const code = value.codePointAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    code === 95 ||
    (code >= 97 && code <= 122)
  );
}

function hasIdentifierSuffix(title, startIndex, idText) {
  const nextChar = title[startIndex + idText.length] || '';
  return isWordCharacter(nextChar);
}

function stripProblemIdPrefix(titleText, problemId) {
  const normalizedTitle = normalizeSpace(titleText);
  const idText = problemId == null ? '' : String(problemId).trim();

  if (!normalizedTitle || !idText) {
    return normalizedTitle;
  }

  const prefixIndex = skipProblemIdPrefixMarkers(normalizedTitle);

  if (!normalizedTitle.startsWith(idText, prefixIndex)) {
    return normalizedTitle;
  }

  if (hasIdentifierSuffix(normalizedTitle, prefixIndex, idText)) {
    return normalizedTitle;
  }

  return normalizedTitle.slice(prefixIndex + idText.length).trimStart();
}

function classifyProblemStatus(scoreInfo) {
  const maxPoints = Number.isFinite(scoreInfo?.maxScore) ? scoreInfo.maxScore : 100;

  if (scoreInfo?.userScore == null) {
    return 'unattempted';
  }

  if (scoreInfo.userScore >= maxPoints) {
    return 'solved';
  }

  return 'tried';
}

module.exports = {
  parseScoreText,
  selectScoreFromCandidates,
  getTooltipText,
  buildScoreCandidatesFromCard,
  extractScoreInfoFromCard,
  extractScoreInfoFromProblemPage,
  extractProblemMetaFromProblemPage,
  stripProblemIdPrefix,
  classifyProblemStatus,
};
