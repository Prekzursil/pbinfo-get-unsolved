const { normalizeSpace } = require('./text-utils');
const {
  extractScoreInfoFromCard,
  extractScoreInfoFromProblemPage,
  extractProblemMetaFromProblemPage,
  classifyProblemStatus,
} = require('./score-parsing');

/**
 * Read visible text content from a DOM node.
 * @param {Element|null|undefined} node
 * @returns {string}
 */
function readTrimmedText(node) {
  if (!node) {
    return '';
  }
  const value = typeof node.innerText === 'string' ? node.innerText : node.textContent;
  return String(value || '').trim();
}

function resolveProblemLink(problemId, canonicalHref, locationOrigin = 'https://www.pbinfo.ro') {
  if (canonicalHref != null) {
    return new URL(canonicalHref, locationOrigin).toString();
  }
  return new URL(`/probleme/${problemId}`, locationOrigin).toString();
}

function normalizePostedByImageUrl(value) {
  let imageUrl = normalizeSpace(value || '');
  if (!imageUrl) {
    return '';
  }
  try {
    const host = new URL(imageUrl).hostname;
    if (host === 'www.gravatar.com') {
      imageUrl = imageUrl.replace(/&s=\d+/i, '&s=128');
    } else if (host === 'www.pbinfo.ro') {
      imageUrl = imageUrl.replace(/&gsize=\d+/i, '&gsize=128');
    }
  } catch {}
  return imageUrl;
}

function readProblemRecordScoreState(scoreInfo) {
  const userScore = scoreInfo?.userScore;
  return {
    userScore,
    scoreKnown: userScore != null && Number.isFinite(userScore),
    maxScore: Number.isFinite(scoreInfo?.maxScore) ? scoreInfo.maxScore : 100,
  };
}

function readProblemRecordMetadata(metadata = {}) {
  return {
    postedBy_link: metadata.postedBy_link || '',
    postedBy_name: metadata.postedBy_name || '',
    postedBy_img: metadata.postedBy_img || '',
    author: metadata.author || '',
    source: metadata.source || '',
  };
}

function buildProblemRecord(problemData = {}) {
  const scoreState = readProblemRecordScoreState(problemData.scoreInfo);
  const metadata = readProblemRecordMetadata(problemData.metadata);

  return {
    id: problemData.id,
    name: problemData.name,
    link: problemData.link,
    difficulty: problemData.difficulty,
    score: scoreState.scoreKnown ? scoreState.userScore : -1,
    scoreKnown: scoreState.scoreKnown,
    userScore: scoreState.userScore,
    maxScore: scoreState.maxScore,
    status: problemData.status,
    quality: 'scan-only',
    verifiedAt: null,
    postedBy_link: metadata.postedBy_link,
    postedBy_name: metadata.postedBy_name,
    postedBy_img: metadata.postedBy_img,
    author: metadata.author,
    source: metadata.source,
  };
}

function parseListProblemCard(card) {
  const codeEl = card.querySelector('code');
  if (!codeEl) {
    return { kind: 'skip' };
  }

  const idText = normalizeSpace(codeEl.textContent);
  const idMatch = /(\d+)/.exec(idText);
  const id = idMatch ? Number.parseInt(idMatch[1], 10) : Number.NaN;
  if (!Number.isFinite(id)) {
    return { kind: 'invalid-id' };
  }

  let name = '';
  let link = '';
  const nameAnchor = card.querySelector('h5.card-title a');
  if (nameAnchor) {
    name = readTrimmedText(nameAnchor);
    link = String(nameAnchor.href || '').trim();
  }

  let difficulty = 3;
  const diffEl = card.querySelector('span[title="Dificultate"]');
  if (diffEl) {
    const text = readTrimmedText(diffEl).toLowerCase();
    if (text.includes('ușo')) {
      difficulty = 0;
    } else if (text.includes('med')) {
      difficulty = 1;
    } else if (text.includes('dific')) {
      difficulty = 2;
    }
  }

  let postedBy_link = '';
  let postedBy_name = '';
  let postedBy_img = '';
  const postedByAnchor = card.querySelector('span[title="Postată de"] a');
  if (postedByAnchor) {
    postedBy_link = postedByAnchor.href;
    postedBy_name = readTrimmedText(postedByAnchor);
    postedBy_img = normalizePostedByImageUrl(postedByAnchor.querySelector('img')?.src);
  }

  const author = normalizeSpace(card.querySelector('span[title="Autor"]')?.textContent || '');
  const source = readTrimmedText(card.querySelector('blockquote[title="Sursa problemei"]'));
  const scoreInfo = extractScoreInfoFromCard(card);
  const status = classifyProblemStatus(scoreInfo);

  return {
    kind: 'ok',
    id,
    scoreInfo,
    status,
    parseFailed: scoreInfo.candidates.length === 0,
    problem: buildProblemRecord({
      id,
      name,
      link,
      difficulty,
      scoreInfo,
      status,
      metadata: {
        postedBy_link,
        postedBy_name,
        postedBy_img,
        author,
        source,
      },
    }),
  };
}

function parseIdRangeProblemPage({ pageDoc, pageIndex, knownIdRangeScore, locationOrigin }) {
  const canonicalAttr = pageDoc.querySelector('link[rel="canonical"]')?.getAttribute?.('href');
  const link = resolveProblemLink(pageIndex, canonicalAttr, locationOrigin);
  const meta = extractProblemMetaFromProblemPage(pageDoc, pageIndex);
  const rawScoreInfo = extractScoreInfoFromProblemPage(pageDoc);
  const scoreInfo =
    Number.isFinite(knownIdRangeScore) &&
    (rawScoreInfo.userScore == null || !Number.isFinite(rawScoreInfo.userScore))
      ? { ...rawScoreInfo, userScore: knownIdRangeScore, maxScore: 100 }
      : rawScoreInfo;
  const status = classifyProblemStatus(scoreInfo);

  return {
    link,
    meta,
    scoreInfo,
    status,
    hasUserScoreNode: pageDoc.querySelector('#scor_utilizator_problema') != null,
    problem: buildProblemRecord({
      id: pageIndex,
      name: meta.name,
      link,
      difficulty: meta.difficulty,
      scoreInfo,
      status,
      metadata: {
        postedBy_link: meta.postedBy_link,
        postedBy_name: meta.postedBy_name,
        postedBy_img: meta.postedBy_img,
        author: meta.author,
        source: meta.source,
      },
    }),
  };
}

function createIdRangeProblemFromKnownScore({ problemId, scoreValue, locationOrigin }) {
  if (!Number.isFinite(problemId) || !Number.isFinite(scoreValue)) {
    return null;
  }
  const maxScore = 100;
  const scoreInfo = {
    userScore: scoreValue,
    maxScore,
  };
  const status = scoreValue >= maxScore ? 'solved' : 'tried';
  return buildProblemRecord({
    id: problemId,
    name: '',
    link: resolveProblemLink(problemId, null, locationOrigin),
    difficulty: 3,
    scoreInfo,
    status,
  });
}

module.exports = {
  parseListProblemCard,
  parseIdRangeProblemPage,
  createIdRangeProblemFromKnownScore,
};
