function buildIdRangeScoreBatchRequest({ batchStart, size, endId }) {
  if (!Number.isFinite(batchStart)) {
    return null;
  }
  if (!Number.isFinite(size) || size <= 0) {
    return null;
  }
  if (!Number.isFinite(endId)) {
    return null;
  }

  const batchEnd = Math.min(endId, batchStart + size - 1);
  if (batchEnd < batchStart) {
    return null;
  }

  const ids = [];
  for (let id = batchStart; id <= batchEnd; id += 1) {
    ids.push(id);
  }
  return {
    batchEnd,
    ids,
    cacheKey: `${batchStart}-${batchEnd}`,
  };
}

function classifyScoreBatchResponse({ status, responseText, isBlockedHtml = () => false }) {
  if (status === 429) {
    return 'rate-limited';
  }
  if (isBlockedHtml(responseText)) {
    return 'blocked';
  }
  if (status !== 200) {
    return 'http-error';
  }
  return 'success';
}

function parseScoreBatchPayload(responseText) {
  try {
    return typeof responseText === 'string' ? JSON.parse(responseText) : responseText;
  } catch {
    return null;
  }
}

function parseScoreBatchId(item) {
  const id = Number.parseInt(item?.id_problema, 10);
  if (!Number.isFinite(id)) {
    return null;
  }
  return id;
}

function readRawScoreValue(item) {
  if (item?.scor == null) {
    return '-';
  }
  return String(item.scor);
}

function parseNormalizedScore(parseScoreValue, rawScore) {
  if (typeof parseScoreValue !== 'function') {
    return { raw: rawScore, value: null };
  }
  const parsed = parseScoreValue(rawScore);
  return {
    raw: typeof parsed?.raw === 'string' ? parsed.raw : rawScore,
    value: Number.isFinite(parsed?.value) ? parsed.value : null,
  };
}

function parseScoreBatchEntry(item, parseScoreValue) {
  const id = parseScoreBatchId(item);
  if (id == null) {
    return null;
  }
  const raw = readRawScoreValue(item);
  const normalizedScore = parseNormalizedScore(parseScoreValue, raw);
  return { id, raw: normalizedScore.raw, value: normalizedScore.value };
}

function readScoreBatchData(payload) {
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  return [];
}

function appendParsedScoreEntry(parsedScores, item, parseScoreValue) {
  const parsedScore = parseScoreBatchEntry(item, parseScoreValue);
  if (parsedScore) {
    parsedScores.push(parsedScore);
  }
}

function parseScoreBatchResponsePayload({ responseText, parseScoreValue }) {
  const payload = parseScoreBatchPayload(responseText);
  const data = readScoreBatchData(payload);
  const parsedScores = [];
  for (const item of data) {
    appendParsedScoreEntry(parsedScores, item, parseScoreValue);
  }
  return parsedScores;
}

function buildPageUnitLabel(scanMode, pageIndex) {
  return scanMode === 'id-range' ? `ID ${pageIndex}` : `pagina ${pageIndex}`;
}

function isIdRangeMissingResponse(scanMode, status, responseText, isNotFoundHtml) {
  if (scanMode !== 'id-range') {
    return false;
  }
  if (status === 404) {
    return true;
  }
  return isNotFoundHtml(responseText);
}

function isIdRangeForbiddenResponse(scanMode, status) {
  if (scanMode !== 'id-range') {
    return false;
  }
  return status === 401 || status === 403;
}

function isInvalidRequestResponse(responseText) {
  return /invalid request/i.test(responseText);
}

function classifyPageFetchResponse({
  scanMode,
  status,
  responseText,
  isBlockedHtml = () => false,
  isNotFoundHtml = () => false,
}) {
  const checks = [
    { matched: status === 429, kind: 'rate-limited' },
    { matched: isBlockedHtml(responseText), kind: 'blocked' },
    {
      matched: isIdRangeMissingResponse(scanMode, status, responseText, isNotFoundHtml),
      kind: 'id-range-missing',
    },
    { matched: isIdRangeForbiddenResponse(scanMode, status), kind: 'id-range-forbidden' },
    { matched: status !== 200, kind: 'http-error' },
    { matched: isInvalidRequestResponse(responseText), kind: 'invalid-request' },
  ];
  const firstMatch = checks.find((entry) => entry.matched);
  if (firstMatch) {
    return firstMatch.kind;
  }
  return 'success';
}

module.exports = {
  buildIdRangeScoreBatchRequest,
  classifyScoreBatchResponse,
  parseScoreBatchResponsePayload,
  buildPageUnitLabel,
  classifyPageFetchResponse,
};
