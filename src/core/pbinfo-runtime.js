// Shared browser runtime entry point for pbinfo-get-unsolved.
// Pure helpers live in sibling modules under src/core and are exported for tests via src/core/index.js.

const { normalizeSpace, normalizeForMatch } = require('./text-utils');
const { appendSimpleMarkup } = require('./log-markup');
const {
  parseScoreText,
  selectScoreFromCandidates,
  getTooltipText,
  buildScoreCandidatesFromCard,
  extractScoreInfoFromCard,
  extractScoreInfoFromProblemPage,
  extractProblemMetaFromProblemPage,
  classifyProblemStatus,
} = require('./score-parsing');
const {
  isLikelyPbinfoNotFoundHtml,
  isLikelyPbinfoBlockedHtml,
  parseTotalProblems,
  normalizeListUrl,
  buildPageUrl,
  computeBackoffWithJitter,
  nextAdaptiveThrottleState,
  parseRetryAfterMs,
  detectPbinfoUserNamespace,
} = require('./network');
const { normalizeProblemQuality, filterProblemsByQuality } = require('./quality');
const { createParsedCacheEntry, isParsedCacheEntryFresh } = require('./cache');
const {
  createOutcomeLedger,
  recordOutcomeEntry,
  summarizeOutcomeLedger,
  listRetryableOutcomeKeys,
  listRetryableOutcomeEntries,
} = require('./outcomes');
const {
  createNavigationState,
  pickNextNavigationProblem,
  pickRandomNavigationProblem,
} = require('./navigation');
const {
  problemsToCsv,
  problemsToLinksText,
  problemsToIdsText,
  problemsToMarkdownText,
  buildResultsExportPayload,
  applyVerifiedScoreToProblem,
} = require('./results-export');
const {
  serializeProblemForSnapshot,
  computeResumeFromStateSnapshot,
  restoreProblemFromSnapshotEntry,
  restoreProblemsFromSnapshot,
  migrateStateSnapshotToV2,
  extractSnapshotFromImport,
} = require('./snapshot');
const { buildProgressText, formatDuration } = require('./progress');
const {
  STORAGE_NAMESPACE,
  STATE_STORAGE_VERSION,
  LEGACY_STATE_STORAGE_VERSION,
  safeJsonParse,
  createSnapshotId,
  makeStateKeys,
  createIndexedDbStorage,
} = require('./runtime-storage');
const {
  normalizeScanMode,
  applyThemePreference,
  loadSetupPreferences,
} = require('./runtime-setup');
const {
  formatDateTime,
  buildSetupWizardDefaults,
  parseStartPageInput,
  parseNormalizedIdRangeInput,
  buildIdRangePageLink,
  applyInitialThemePreference,
  showSetupWizard,
} = require('./runtime-storage-setup');
const {
  parseListProblemCard,
  parseIdRangeProblemPage,
  createIdRangeProblemFromKnownScore,
} = require('./runtime-page-parsing');
const { buildTrustMetricsView, buildOutcomeRetryTargets } = require('./runtime-trust-metrics');
const {
  buildIdRangeScoreBatchRequest,
  classifyScoreBatchResponse,
  parseScoreBatchResponsePayload,
  buildPageUnitLabel,
  classifyPageFetchResponse,
} = require('./runtime-fetch-response');
const { resolveSaveStateLevels, applyPaginationSnapshot } = require('./runtime-state-persistence');
const { restoreRuntimeSnapshotState } = require('./runtime-state-restore');
const { buildRuntimeConfig } = require('./runtime-config');

function parseHtmlDocument(responseText) {
  const parser = new DOMParser();
  return parser.parseFromString(String(responseText || ''), 'text/html');
}

function getRetryDelayLabel(delayMs) {
  const digits = delayMs >= 1000 ? 1 : 2;
  return `${(delayMs / 1000).toFixed(digits)}s`;
}

function sortSymbol(sorted, type) {
  if (sorted[type] === 1) return '▼';
  if (sorted[type] === -1) return '▲';
  return '▶';
}

function numberToDifficulty(value) {
  if (value === 0) return 'ușoară';
  if (value === 1) return 'medie';
  if (value === 2) return 'dificilă';
  return 'concurs';
}

function difficultyColor(value) {
  if (value === 0) return '5cb85c';
  if (value === 1) return 'f0ad4e';
  if (value === 2) return '5bc0de';
  return 'd9534f';
}

function statusLabel(status) {
  if (status === 'solved') return 'rezolvată';
  if (status === 'tried') return 'încercată';
  return 'neîncercată';
}

function statusColor(status) {
  if (status === 'solved') return '5cb85c';
  if (status === 'tried') return 'f0ad4e';
  return '6c757d';
}

function qualityLabel(quality) {
  const normalized = normalizeProblemQuality(quality);
  if (normalized === 'verified') return 'verified';
  if (normalized === 'verification-unknown') return 'verification unknown';
  return 'scan only';
}

function qualityColor(quality) {
  const normalized = normalizeProblemQuality(quality);
  if (normalized === 'verified') return '2563eb';
  if (normalized === 'verification-unknown') return 'b45309';
  return '6b7280';
}

function getSnapshotLevelLabel(storageLevel) {
  if (storageLevel === 'full') return 'complet';
  if (storageLevel === 'progress') return 'progres';
  return 'compact';
}

function formatClipboardCopySuccessMessage(copiedCount, itemLabel, method) {
  const legacySuffix = method === 'execCommand' ? ' (fallback legacy copy)' : '';
  return `Am copiat ${copiedCount} ${itemLabel} în clipboard${legacySuffix}.`;
}

function formatClipboardCopyErrorMessage(itemLabel, errorDescription) {
  return `<span style="color:#b30000;">Nu am putut copia ${itemLabel} în clipboard. ${errorDescription}</span>`;
}

async function copyVisibleProblemsToClipboard({
  getVisibleProblems,
  toText,
  copyTextToClipboard,
  addLog,
  describeClipboardError,
  successItemLabel,
  failureItemLabel,
}) {
  const visible = getVisibleProblems();
  const text = toText(visible);
  if (!text) {
    addLog('Nimic de copiat.');
    return;
  }

  try {
    const result = await copyTextToClipboard(text);
    addLog(formatClipboardCopySuccessMessage(visible.length, successItemLabel, result?.method));
  } catch (error) {
    addLog(formatClipboardCopyErrorMessage(failureItemLabel, describeClipboardError(error)));
    console.error(error);
  }
}

function appendClipboardCopyButton({ group, buttonLabel, onCopy }) {
  const button = document.createElement('button');
  button.textContent = buttonLabel;
  button.addEventListener('click', onCopy);
  group.appendChild(button);
}

function takeSmallestDeferredEntry(map, keyName) {
  if (!(map instanceof Map) || map.size === 0) return null;

  let bestKey = null;
  let bestRetry = 0;
  for (const [candidateKey, retryCount] of map.entries()) {
    if (bestKey == null || candidateKey < bestKey) {
      bestKey = candidateKey;
      bestRetry = retryCount;
    }
  }

  if (bestKey == null) return null;
  map.delete(bestKey);
  return {
    [keyName]: bestKey,
    retryCount: bestRetry,
  };
}

function selectKickAction({
  deferredVerification,
  deferredBatch,
  deferredPage,
  queueInitialized,
  nextSequentialPage,
}) {
  let action = { kind: 'idle' };

  if (deferredVerification) {
    action = {
      kind: 'verify',
      problemId: deferredVerification.problemId,
      retryCount: deferredVerification.retryCount,
    };
  } else if (deferredBatch) {
    action = {
      kind: 'score-batch',
      batchStart: deferredBatch.batchStart,
      retryCount: deferredBatch.retryCount,
    };
  } else if (deferredPage) {
    action = {
      kind: 'page',
      pageIndex: deferredPage.pageIndex,
      retryCount: deferredPage.retryCount,
    };
  } else if (queueInitialized) {
    action = { kind: 'queue' };
  } else if (nextSequentialPage != null) {
    action = {
      kind: 'sequential',
      pageIndex: nextSequentialPage,
    };
  }

  return action;
}

function isRuntimeQueueDrained({
  queueInitialized,
  pageQueueLength,
  deferredScoreBatchCount,
  deferredVerificationCount,
  inFlight,
}) {
  const checks = [
    queueInitialized === true,
    pageQueueLength === 0,
    deferredScoreBatchCount === 0,
    deferredVerificationCount === 0,
    inFlight === 0,
  ];

  return checks.every(Boolean);
}

function shouldStartVerificationPass({ verificationState, hasUnsolvedProblems }) {
  return (
    !verificationState.running &&
    verificationState.enabled &&
    !verificationState.completed &&
    hasUnsolvedProblems
  );
}

function pruneSnapshotEntries(index, { maxEntries, snapshotItemKey, storageHasValue }) {
  const pruned = [];
  const staleKeys = [];
  const keepIds = new Set();

  for (const entry of index) {
    const key = snapshotItemKey(entry.id, entry.storageVersion);
    if (!key || !storageHasValue(key)) continue;
    pruned.push(entry);
    keepIds.add(entry.id);
    if (pruned.length >= maxEntries) break;
  }

  for (const entry of index) {
    if (keepIds.has(entry.id)) continue;
    const key = snapshotItemKey(entry.id, entry.storageVersion);
    if (!key) continue;
    staleKeys.push(key);
  }

  return { pruned, staleKeys };
}

async function resolveScanModeSelection({
  overlayEnabled,
  modePromptDisabled,
  modeFromWindow,
  defaultLink,
  config,
  setupDefaults,
  localStorageApi,
  documentRef,
  locationRef,
  setSelectOptions,
}) {
  let scanMode = modeFromWindow;
  let setupSelection = null;

  if (modePromptDisabled) {
    return finalizeScanModeSelection(scanMode, setupSelection);
  }

  if (overlayEnabled) {
    setupSelection = await showSetupWizard({
      defaultLink,
      config,
      defaults: buildSetupWizardDefaults({ setupDefaults, modeFromWindow, defaultLink, config }),
      overlayEnabled,
      localStorageApi,
      documentRef,
      locationRef,
      setSelectOptions,
    });
    if (!setupSelection) {
      return {
        aborted: true,
        warning: 'Setup wizard anulat. Scriptul a fost oprit.',
      };
    }
    scanMode = setupSelection.scanMode;
    applySetupSelectionToConfig(config, setupSelection);
    return finalizeScanModeSelection(scanMode, setupSelection);
  }

  const promptMode = resolvePromptScanModeSelection(modeFromWindow);
  if (promptMode.aborted) {
    return promptMode;
  }
  scanMode = promptMode.scanMode;

  return finalizeScanModeSelection(scanMode, setupSelection);
}

function applySetupSelectionToConfig(config, setupSelection) {
  config.concurrency = setupSelection.concurrency;
  config.delayMs = setupSelection.delayMs;
  config.cache.forceRefresh = setupSelection.forceRefresh === true;
}

function finalizeScanModeSelection(scanMode, setupSelection) {
  const resolvedScanMode = scanMode || 'list';
  return {
    aborted: false,
    scanMode: resolvedScanMode,
    setupSelection,
    wizardVerifyUnsolved: resolveWizardVerifyUnsolvedSelection(setupSelection),
  };
}

function resolvePromptScanModeSelection(modeFromWindow) {
  const defaultModePromptValue = modeFromWindow === 'id-range' ? '2' : '1';
  let modeInput = prompt(
    'Mod scanare:\n' +
      '1 = listă (paginare)\n' +
      '2 = interval ID (probleme/ID)\n' +
      `Enter = ${defaultModePromptValue}`,
    defaultModePromptValue
  );
  if (modeInput === null) {
    return {
      aborted: true,
      warning: 'Nu a fost selectat un mod de scanare. Scriptul a fost oprit.',
    };
  }

  modeInput = normalizeSpace(modeInput);
  let scanMode = normalizeScanMode(modeInput) || (modeInput === '' ? null : 'list');
  if (!scanMode) scanMode = modeFromWindow || 'list';
  return { aborted: false, scanMode };
}

function resolveWizardVerifyUnsolvedSelection(setupSelection) {
  if (!setupSelection || !Object.hasOwn(setupSelection, 'verifyUnsolved')) return null;
  return setupSelection.verifyUnsolved === true;
}

function resolvePageLinkFromSetupSelection(setupSelection, scanMode, config) {
  if (scanMode === 'id-range') {
    config.idRange.startId = setupSelection.idRange.startId;
    config.idRange.endId = setupSelection.idRange.endId;
  }
  config.startPage = setupSelection.startPage;
  return {
    aborted: false,
    pageLink: setupSelection.pageLink,
  };
}

function resolveIdRangePromptPageLink(config, locationRef) {
  const defaultRange = `${config.idRange.startId}-${config.idRange.endId}`;
  const idRangeInput = prompt(
    'Interval ID de scanat (ex: 1-8000).\n' +
      'Notă: scanarea pe ID-uri este mai lentă și poate necesita delay/concurență mică.',
    defaultRange
  );
  if (idRangeInput === null) {
    return {
      aborted: true,
      warning: 'Nu a fost furnizat intervalul ID. Scriptul a fost oprit.',
    };
  }

  const range = parseNormalizedIdRangeInput(idRangeInput, defaultRange);
  if (!range) {
    return {
      aborted: true,
      warning: 'Interval ID invalid. Scriptul a fost oprit.',
    };
  }

  const { startId, endId } = range;
  config.idRange.startId = startId;
  config.idRange.endId = endId;
  config.startPage = startId;
  return {
    aborted: false,
    pageLink: buildIdRangePageLink(locationRef, range),
  };
}

function resolveListPromptPageLink(defaultLink, config) {
  let pageLinkInput = prompt(
    'Pune un link către lista de probleme de unde vrei să obții problemele nerezolvate.\n' +
      'Enter = pagina curentă. Dacă folosești filtre, copiază link-ul din bara de adrese.',
    defaultLink
  );
  if (pageLinkInput === null) {
    return {
      aborted: true,
      warning: 'Nu a fost furnizat niciun link. Scriptul a fost oprit.',
    };
  }
  pageLinkInput = normalizeSpace(pageLinkInput);
  const normalizedPageLink = normalizeListUrl(
    pageLinkInput || defaultLink,
    defaultLink,
    config.pagination.param
  );
  if (!normalizedPageLink) {
    return {
      aborted: true,
      warning: 'Link invalid. Scriptul a fost oprit.',
    };
  }
  return {
    aborted: false,
    pageLink: normalizedPageLink,
  };
}

function resolvePageLinkSelection({ setupSelection, scanMode, config, defaultLink, locationRef }) {
  if (setupSelection) {
    return resolvePageLinkFromSetupSelection(setupSelection, scanMode, config);
  }
  if (scanMode === 'id-range') {
    return resolveIdRangePromptPageLink(config, locationRef);
  }
  return resolveListPromptPageLink(defaultLink, config);
}

function setSelectOptions(select, options) {
  select.replaceChildren();
  for (const option of options) {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    select.appendChild(node);
  }
}

function buildListPageLinkMessage(listPageLink) {
  const fragment = document.createDocumentFragment();
  const anchor = document.createElement('a');
  const italic = document.createElement('i');

  fragment.appendChild(document.createTextNode('Link către lista de probleme: '));
  anchor.href = listPageLink;
  anchor.rel = 'noopener noreferrer';
  anchor.target = '_blank';
  italic.textContent = listPageLink;
  anchor.appendChild(italic);
  fragment.appendChild(anchor);
  return fragment;
}

function setGroupTitle(group, titleText) {
  group.replaceChildren();
  const bold = document.createElement('b');
  bold.textContent = titleText;
  group.appendChild(bold);
}

function isSnapshotSelection(selectedValue) {
  return normalizeSpace(selectedValue).startsWith('snapshot:');
}

function buildProblemListNode(items) {
  if (items.length === 0) {
    const muted = document.createElement('span');
    muted.className = 'muted';
    muted.textContent = '-';
    return muted;
  }

  const ul = document.createElement('ul');
  ul.style.listStyle = 'none';
  ul.style.paddingLeft = '0';
  ul.style.margin = '0';
  for (const problem of items) {
    const li = document.createElement('li');
    li.style.margin = '0.15em 0';
    const anchor = document.createElement('a');
    anchor.href = problem.link;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = problem.name ? `#${problem.id} - ${problem.name}` : `#${problem.id}`;
    li.appendChild(anchor);
    ul.appendChild(li);
  }
  return ul;
}

function createListPageSummary() {
  return {
    pageSolved: 0,
    pageTried: 0,
    pageUnattempted: 0,
    totalCount: 0,
    parseFailCount: 0,
    idFailCount: 0,
  };
}

function incrementListPageStatusCounters(summary, status, stats) {
  if (status === 'solved') {
    summary.pageSolved++;
    stats.solved++;
    return;
  }
  if (status === 'tried') {
    summary.pageTried++;
    stats.tried++;
    return;
  }
  summary.pageUnattempted++;
  stats.unattempted++;
}

function compareSortableValues(left = '', right = '') {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function formatOutcomeStatusLabel(status) {
  if (status === 'rate-limited') return 'rate limited';
  if (status === 'parse-fail') return 'parse fail';
  if (status === 'http-error') return 'http error';
  return normalizeSpace(status || 'unknown') || 'unknown';
}

function normalizeSnapshotStorageLevel(storageLevel) {
  const value = normalizeSpace(storageLevel);
  if (value === 'full' || value === 'minimal' || value === 'progress') {
    return value;
  }
  return 'minimal';
}

function resolvePromptStartPageValue(scanMode, config) {
  const promptText =
    scanMode === 'id-range'
      ? 'De la ce ID să încep scanarea?\n' +
        `Interval: ${config.idRange.startId}-${config.idRange.endId}\n` +
        'Pentru resume, pune un număr mai mare.\n' +
        'Enter = valoarea default.'
      : 'De la ce pagină să încep scanarea?\n' +
        '1 = de la început. Pentru resume, pune un număr mai mare.\n' +
        'Enter = valoarea default.';
  let startPageInput = prompt(promptText, String(config.startPage));
  if (startPageInput === null) {
    return {
      aborted: true,
      warning: 'Nu a fost furnizat start. Scriptul a fost oprit.',
    };
  }
  startPageInput = normalizeSpace(startPageInput);
  const startPage = parseStartPageInput(startPageInput, config.startPage);
  if (startPage == null) {
    return {
      aborted: true,
      warning: 'Start invalid. Scriptul a fost oprit.',
    };
  }
  if (scanMode === 'id-range' && startPage > config.idRange.endId) {
    return {
      aborted: true,
      warning: 'Start ID peste capătul intervalului. Scriptul a fost oprit.',
    };
  }
  return {
    aborted: false,
    startPage,
  };
}

function resolveStorageBackendPreference(runtimeGlobal) {
  return normalizeSpace(runtimeGlobal.PBINFO_GET_UNSOLVED_STORAGE_BACKEND || 'auto').toLowerCase();
}

function resolveDefaultLinkHref(locationRef) {
  return locationRef && typeof locationRef.href === 'string' ? locationRef.href : '';
}

function resolveNumberSetting(rawValue, fallback, minValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minValue, parsed);
}

function resolveIdRangeLogEvery(runtimeGlobal) {
  return resolveNumberSetting(runtimeGlobal.PBINFO_GET_UNSOLVED_ID_LOG_EVERY, 200, 50);
}

function createLiveRenderConfig(runtimeGlobal) {
  return {
    enabled: runtimeGlobal.PBINFO_GET_UNSOLVED_LIVE_RENDER === true,
    everyPages: resolveNumberSetting(
      runtimeGlobal.PBINFO_GET_UNSOLVED_LIVE_RENDER_EVERY_PAGES,
      2,
      1
    ),
    minMs: resolveNumberSetting(runtimeGlobal.PBINFO_GET_UNSOLVED_LIVE_RENDER_MIN_MS, 750, 0),
  };
}

function createAutosaveConfig(runtimeGlobal) {
  return {
    enabled: runtimeGlobal.PBINFO_GET_UNSOLVED_AUTOSAVE !== false,
    everyPages: resolveNumberSetting(runtimeGlobal.PBINFO_GET_UNSOLVED_AUTOSAVE_PAGES, 50, 1),
    everyMs: resolveNumberSetting(runtimeGlobal.PBINFO_GET_UNSOLVED_AUTOSAVE_MS, 120000, 5000),
  };
}

function createSnapshotConfig(runtimeGlobal) {
  return {
    maxEntries: resolveNumberSetting(runtimeGlobal.PBINFO_GET_UNSOLVED_SNAPSHOTS_MAX, 8, 1),
  };
}

function setupRuntimeUiRoot({ documentRef, overlayEnabled, uiRootId }) {
  try {
    documentRef.getElementById(uiRootId)?.remove();
  } catch {}
  if (!overlayEnabled) {
    documentRef.head.replaceChildren();
    documentRef.body.replaceChildren();
    documentRef.body.style.margin = '0';
    documentRef.body.style.padding = '0';
  }
  const appRoot = documentRef.createElement('div');
  appRoot.id = uiRootId;
  if (overlayEnabled) {
    appRoot.style.position = 'fixed';
    appRoot.style.top = '0';
    appRoot.style.left = '0';
    appRoot.style.right = '0';
    appRoot.style.bottom = '0';
    appRoot.style.zIndex = '2147483647';
    appRoot.style.overflow = 'auto';
    appRoot.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.15)';
  }
  documentRef.body.appendChild(appRoot);
  return appRoot;
}

function logScanStartContext({ scanMode, config, pageLink, addLog, buildListPageLinkMessage }) {
  if (scanMode === 'id-range') {
    addLog(`Mod scanare: <b>interval ID</b> (${config.idRange.startId}-${config.idRange.endId}).`);
    addLog(`Start ID: <b>${config.startPage}</b>.`);
    return;
  }
  addLog(buildListPageLinkMessage(pageLink));
  addLog(`Start page: <b>${config.startPage}</b>.`);
}

function resolveVerificationEnabled(initialEnabled, wizardVerifyUnsolved) {
  if (typeof wizardVerifyUnsolved === 'boolean') {
    return wizardVerifyUnsolved;
  }
  return initialEnabled;
}

function resolveSavedProblemCount(candidate) {
  if (Number.isFinite(candidate.stats?.total)) {
    return candidate.stats.total;
  }
  if (Array.isArray(candidate.problems)) {
    return candidate.problems.length;
  }
  return null;
}

function buildSavedStateResumeMessage({ scanMode, kind, savedAt, pages, problems }) {
  const note = kind === 'minimal' ? ' (doar progres, fără lista completă)' : '';
  const unitLabel = scanMode === 'id-range' ? 'ID-uri scanate' : 'Pagini scanate';
  const header =
    scanMode === 'id-range'
      ? `Am găsit un scan salvat pentru acest interval${note}.\n`
      : `Am găsit un scan salvat pentru acest link${note}.\n`;
  const pagesLine = pages === null || pages === undefined ? '' : `${unitLabel}: ${pages}\n`;
  const problemsLine =
    problems === null || problems === undefined ? '' : `Probleme scanate: ${problems}\n`;
  return (
    header +
    `Salvat la: ${savedAt}\n` +
    pagesLine +
    problemsLine +
    '\nOK = încarcă, Cancel = ignoră'
  );
}

function applySavedStartPage(config, candidate) {
  if (Number.isFinite(candidate.scanStartPage)) {
    config.startPage = candidate.scanStartPage;
    return;
  }
  if (Number.isFinite(candidate.config?.startPage)) {
    config.startPage = candidate.config.startPage;
  }
}

function resolveSavedStateAndStartPage({
  scanMode,
  pageLink,
  setupSelection,
  config,
  stateKeys,
  legacyStateKeys,
  storageGetJson,
}) {
  const savedFull = migrateStateSnapshotToV2(
    storageGetJson([stateKeys.full, legacyStateKeys.full])
  );
  const savedMinimal =
    savedFull == null
      ? migrateStateSnapshotToV2(storageGetJson([stateKeys.minimal, legacyStateKeys.minimal]))
      : null;

  let pendingRestore = null;
  let restoreMode = null;
  const candidate = savedFull || savedMinimal;
  if (candidate && candidate.pageLink === pageLink) {
    const savedAt = formatDateTime(candidate.savedAt);
    const pages = Number.isFinite(candidate.stats?.pages) ? candidate.stats.pages : null;
    const problems = resolveSavedProblemCount(candidate);
    const kind = savedFull ? 'full' : 'minimal';
    const resumeMessage = buildSavedStateResumeMessage({
      scanMode,
      kind,
      savedAt,
      pages,
      problems,
    });
    const shouldResume = setupSelection
      ? setupSelection.resumeSavedState === true || setupSelection.resumeSavedState === undefined
      : confirm(resumeMessage);
    if (shouldResume) {
      pendingRestore = candidate;
      restoreMode = kind;
      applyPaginationSnapshot(config.pagination, candidate.pagination);
      applySavedStartPage(config, candidate);
    }
  }

  if (pendingRestore == null && setupSelection == null) {
    const promptResult = resolvePromptStartPageValue(scanMode, config);
    if (promptResult.aborted) {
      return promptResult;
    }
    config.startPage = promptResult.startPage;
  }

  return {
    aborted: false,
    pendingRestore,
    restoreMode,
  };
}

async function resolveStartupSelections({
  overlayEnabled,
  config,
  setupDefaults,
  defaultLink,
  localStorageApi,
  documentRef,
  locationRef,
  runtimeGlobal,
  initIndexedDbState,
  storageGetJson,
  normalizeSnapshotIndexFn,
  snapshotItemKeyFn,
}) {
  const modeFromWindow = normalizeScanMode(runtimeGlobal.PBINFO_GET_UNSOLVED_MODE);
  const modePromptDisabled = runtimeGlobal.PBINFO_GET_UNSOLVED_MODE_PROMPT === false;
  const scanModeSelection = await resolveScanModeSelection({
    overlayEnabled,
    modePromptDisabled,
    modeFromWindow,
    defaultLink,
    config,
    setupDefaults,
    localStorageApi,
    documentRef,
    locationRef,
    setSelectOptions,
  });
  if (scanModeSelection.aborted) {
    return {
      aborted: true,
      warning: scanModeSelection.warning,
    };
  }

  const scanMode = scanModeSelection.scanMode;
  config.scanMode = scanMode;
  const setupSelection = scanModeSelection.setupSelection;
  const wizardVerifyUnsolved = scanModeSelection.wizardVerifyUnsolved;

  const pageLinkSelection = resolvePageLinkSelection({
    setupSelection,
    scanMode,
    config,
    defaultLink,
    locationRef,
  });
  if (pageLinkSelection.aborted) {
    return {
      aborted: true,
      warning: pageLinkSelection.warning,
    };
  }

  const pageLink = pageLinkSelection.pageLink;
  const stateKeys = makeStateKeys(pageLink, STATE_STORAGE_VERSION);
  const legacyStateKeys = makeStateKeys(pageLink, LEGACY_STATE_STORAGE_VERSION);
  await initIndexedDbState([
    stateKeys.full,
    stateKeys.minimal,
    stateKeys.index,
    legacyStateKeys.full,
    legacyStateKeys.minimal,
    legacyStateKeys.index,
  ]);
  const indexedSnapshotEntries = [
    ...normalizeSnapshotIndexFn(storageGetJson(stateKeys.index)),
    ...normalizeSnapshotIndexFn(storageGetJson(legacyStateKeys.index)),
  ];
  const indexedSnapshotKeys = indexedSnapshotEntries
    .map((entry) => snapshotItemKeyFn(entry.id, entry.storageVersion))
    .filter(Boolean);
  if (indexedSnapshotKeys.length > 0) {
    await initIndexedDbState(indexedSnapshotKeys);
  }

  return {
    aborted: false,
    scanMode,
    setupSelection,
    wizardVerifyUnsolved,
    pageLink,
    stateKeys,
    legacyStateKeys,
  };
}

if (globalThis.document === undefined) {
  if (typeof module !== 'undefined') {
    module.exports = {
      normalizeSpace,
      normalizeForMatch,
      parseScoreText,
      selectScoreFromCandidates,
      getTooltipText,
      buildScoreCandidatesFromCard,
      extractScoreInfoFromCard,
      extractScoreInfoFromProblemPage,
      extractProblemMetaFromProblemPage,
      classifyProblemStatus,
      parseTotalProblems,
      normalizeListUrl,
      buildPageUrl,
      computeBackoffWithJitter,
      nextAdaptiveThrottleState,
      migrateStateSnapshotToV2,
      extractSnapshotFromImport,
      problemsToCsv,
      problemsToLinksText,
      problemsToIdsText,
      problemsToMarkdownText,
      parseRetryAfterMs,
      createOutcomeLedger,
      recordOutcomeEntry,
      summarizeOutcomeLedger,
      listRetryableOutcomeKeys,
      listRetryableOutcomeEntries,
      normalizeProblemQuality,
      filterProblemsByQuality,
      createParsedCacheEntry,
      isParsedCacheEntryFresh,
      detectPbinfoUserNamespace,
      buildResultsExportPayload,
      applyVerifiedScoreToProblem,
      createNavigationState,
      pickNextNavigationProblem,
      pickRandomNavigationProblem,
      buildProgressText,
      serializeProblemForSnapshot,
      computeResumeFromStateSnapshot,
      restoreProblemFromSnapshotEntry,
      restoreProblemsFromSnapshot,
      isLikelyPbinfoNotFoundHtml,
      isLikelyPbinfoBlockedHtml,
      formatClipboardCopySuccessMessage,
      formatClipboardCopyErrorMessage,
      copyVisibleProblemsToClipboard,
      takeSmallestDeferredEntry,
      selectKickAction,
      isRuntimeQueueDrained,
      shouldStartVerificationPass,
      pruneSnapshotEntries,
      resolvePageLinkSelection,
    };
  }
} else {
  function appendLatestSessionOption(options, latest) {
    if (!latest) return;
    const savedAt = latest.state?.savedAt ? formatDateTime(latest.state.savedAt) : '-';
    const level =
      latest.kind === 'full' ? 'complet' : getSnapshotLevelLabel(latest.state?.storageLevel);
    options.push({
      value: 'autosave',
      label: `Autosave (${level}) · ${savedAt}`,
      state: latest.state,
      kind: latest.kind,
    });
  }

  function appendSnapshotSessionOptions(options, snapshots) {
    for (const snapshot of snapshots) {
      const savedAt =
        snapshot.savedAt === null || snapshot.savedAt === undefined
          ? '-'
          : formatDateTime(snapshot.savedAt);
      const level = getSnapshotLevelLabel(snapshot.storageLevel);
      const label = normalizeSpace(snapshot.label);
      options.push({
        value: `snapshot:${snapshot.storageVersion || STATE_STORAGE_VERSION}:${snapshot.id}`,
        label:
          `Snapshot v${snapshot.storageVersion || STATE_STORAGE_VERSION} (${level}) · ${savedAt}` +
          (label ? ` · ${label}` : ''),
        state: null,
        kind: snapshot.storageLevel === 'full' ? 'full' : 'minimal',
      });
    }
  }

  function autorunPbinfoGetUnsolved() {
    runPbinfoGetUnsolved().catch((error) => {
      console.error('pbinfo-get-unsolved startup failed.', error);
    });
  }

  async function runPbinfoGetUnsolved() {
    // restore console
    const iFrame = document.createElement('iframe');
    iFrame.style.display = 'none';
    document.body.appendChild(iFrame);
    globalThis.console = iFrame.contentWindow.console;
    console.clear();

    const storageBackendPreference = resolveStorageBackendPreference(globalThis);
    const localStorageApi = globalThis.localStorage;
    const storageController = createIndexedDbStorage({
      backendPreference: storageBackendPreference,
      indexedDBApi: globalThis.indexedDB,
      localStorageApi: localStorageApi,
    });
    const indexedDbState = storageController.state;
    const {
      idbRead,
      idbWrite,
      idbClearStore,
      initIndexedDbState,
      storageHasValue,
      storageGetJson,
      storageSetJson,
      storageRemove,
    } = storageController;

    const config = buildRuntimeConfig(globalThis);

    const adaptiveThrottleState = {
      enabled: Boolean(config.adaptiveThrottle),
      baseDelayMs: config.delayMs,
      baseConcurrency: config.concurrency,
      delayMs: config.delayMs,
      concurrency: config.concurrency,
      cleanStreak: 0,
    };

    function getEffectiveDelayMs() {
      return adaptiveThrottleState.enabled
        ? Math.max(config.delayMs, adaptiveThrottleState.delayMs)
        : config.delayMs;
    }

    function getEffectiveConcurrency() {
      return adaptiveThrottleState.enabled
        ? Math.max(1, Math.min(config.concurrency, adaptiveThrottleState.concurrency))
        : config.concurrency;
    }

    function computeBackoffDelay(attempt) {
      return computeBackoffWithJitter(attempt, {
        baseMs: config.backoffBaseMs,
        capMs: config.backoffCapMs,
        jitter: config.backoffJitter,
      });
    }

    function getRetryDelayMs(retryCount) {
      const retryDelay = computeBackoffDelay(retryCount);
      return Math.max(retryDelay, getEffectiveDelayMs());
    }

    function noteAdaptiveFailure(kind) {
      const next = nextAdaptiveThrottleState(adaptiveThrottleState, kind, {
        capMs: config.backoffCapMs,
      });
      Object.assign(adaptiveThrottleState, next);
    }

    function noteAdaptiveSuccess() {
      const next = nextAdaptiveThrottleState(adaptiveThrottleState, 'success', {
        capMs: config.backoffCapMs,
      });
      Object.assign(adaptiveThrottleState, next);
    }

    const overlayEnabled = globalThis.PBINFO_GET_UNSOLVED_OVERLAY === true;
    const setupDefaults = loadSetupPreferences(localStorageApi);
    const defaultLink = resolveDefaultLinkHref(location);
    const startupSelection = await resolveStartupSelections({
      overlayEnabled,
      config,
      setupDefaults,
      defaultLink,
      localStorageApi,
      documentRef: document,
      locationRef: location,
      runtimeGlobal: globalThis,
      initIndexedDbState,
      storageGetJson,
      normalizeSnapshotIndexFn: normalizeSnapshotIndex,
      snapshotItemKeyFn: snapshotItemKey,
    });
    if (startupSelection.aborted) {
      console.warn(startupSelection.warning);
      return;
    }
    const scanMode = startupSelection.scanMode;
    const setupSelection = startupSelection.setupSelection;
    const wizardVerifyUnsolved = startupSelection.wizardVerifyUnsolved;
    const pageLink = startupSelection.pageLink;
    const stateKeys = startupSelection.stateKeys;
    const legacyStateKeys = startupSelection.legacyStateKeys;
    const parsedCacheState = {
      userNamespace: detectPbinfoUserNamespace(document),
      enabled: Boolean(config.cache.enabled),
      storeName: 'parsedCache',
      memory: new Map(),
      hits: 0,
      writes: 0,
    };
    function refreshParsedCacheAvailability() {
      if (!parsedCacheState.userNamespace) {
        parsedCacheState.userNamespace = detectPbinfoUserNamespace(document);
      }
      parsedCacheState.enabled = Boolean(config.cache.enabled);
      parsedCacheState.sessionEnabled =
        parsedCacheState.enabled && Boolean(parsedCacheState.userNamespace);
      parsedCacheState.persistenceEnabled =
        parsedCacheState.sessionEnabled && indexedDbState.enabled;
    }
    refreshParsedCacheAvailability();

    function buildParsedCacheStorageKey(cacheKind, cacheKey) {
      if (!parsedCacheState.userNamespace) return null;
      return [
        STORAGE_NAMESPACE,
        'cache',
        parsedCacheState.userNamespace,
        normalizeSpace(cacheKind || 'unknown') || 'unknown',
        normalizeSpace(cacheKey == null ? '' : String(cacheKey)) || '?',
      ].join(':');
    }

    async function readParsedCache(cacheKind, cacheKey) {
      refreshParsedCacheAvailability();
      if (!parsedCacheState.sessionEnabled || config.cache.forceRefresh) return null;
      const storageKey = buildParsedCacheStorageKey(cacheKind, cacheKey);
      if (!storageKey) return null;
      if (parsedCacheState.memory.has(storageKey)) {
        const cached = parsedCacheState.memory.get(storageKey);
        if (
          isParsedCacheEntryFresh(cached, {
            now: Date.now(),
            userNamespace: parsedCacheState.userNamespace,
            forceRefresh: config.cache.forceRefresh,
            cacheKind,
            cacheKey,
          })
        ) {
          parsedCacheState.hits++;
          return cached.value;
        }
        parsedCacheState.memory.delete(storageKey);
      }
      let entry;
      try {
        entry = await idbRead(parsedCacheState.storeName, storageKey);
      } catch {}
      if (
        !isParsedCacheEntryFresh(entry, {
          now: Date.now(),
          userNamespace: parsedCacheState.userNamespace,
          forceRefresh: config.cache.forceRefresh,
          cacheKind,
          cacheKey,
        })
      ) {
        return null;
      }
      parsedCacheState.memory.set(storageKey, entry);
      parsedCacheState.hits++;
      return entry.value;
    }

    function writeParsedCache(cacheKind, cacheKey, value) {
      refreshParsedCacheAvailability();
      if (!parsedCacheState.sessionEnabled) return;
      const storageKey = buildParsedCacheStorageKey(cacheKind, cacheKey);
      if (!storageKey) return;
      const entry = createParsedCacheEntry({
        cacheKind,
        cacheKey,
        userNamespace: parsedCacheState.userNamespace,
        value,
        now: Date.now(),
        ttlMs: config.cache.ttlMs,
      });
      parsedCacheState.memory.set(storageKey, entry);
      parsedCacheState.writes++;
      if (parsedCacheState.persistenceEnabled) {
        void idbWrite(parsedCacheState.storeName, storageKey, entry).catch(() => {});
      }
    }

    async function clearParsedCache() {
      refreshParsedCacheAvailability();
      parsedCacheState.memory.clear();
      parsedCacheState.hits = 0;
      parsedCacheState.writes = 0;
      if (!parsedCacheState.persistenceEnabled) return true;
      try {
        return await idbClearStore(parsedCacheState.storeName);
      } catch {
        return false;
      }
    }

    const restoreSelection = resolveSavedStateAndStartPage({
      scanMode,
      pageLink,
      setupSelection,
      config,
      stateKeys,
      legacyStateKeys,
      storageGetJson,
    });
    if (restoreSelection.aborted) {
      console.warn(restoreSelection.warning);
      return;
    }
    let pendingRestore = restoreSelection.pendingRestore;
    let restoreMode = restoreSelection.restoreMode;

    const firstFetchedPageIndex = config.startPage;
    let themePreference = 'system';
    const UI_ROOT_ID = 'pbinfo-get-unsolved-root';
    const UI_STYLE_ID = 'pbinfo-get-unsolved-style';
    const UI_ID_LOG = 'pbinfo-get-unsolved-log';
    const UI_ID_PROGRESS = 'pbinfo-get-unsolved-progress';
    const UI_ID_CONTROLS = 'pbinfo-get-unsolved-controls';
    const UI_ID_TRUST = 'pbinfo-get-unsolved-trust';
    const UI_ID_SUMMARY = 'pbinfo-get-unsolved-summary';

    // setup UI root (overlay or destructive)
    const appRoot = setupRuntimeUiRoot({
      documentRef: document,
      overlayEnabled,
      uiRootId: UI_ROOT_ID,
    });
    themePreference = applyInitialThemePreference({
      localStorageApi,
      appRoot,
      documentElement: document.documentElement,
    });

    const title = document.createElement('h2');
    title.style.display = 'block';
    const titleSpan = document.createElement('span');
    titleSpan.style.color = 'red';
    titleSpan.textContent = 'pbinfo-get-unsolved';
    title.appendChild(titleSpan);
    title.appendChild(document.createTextNode('.'));
    appRoot.appendChild(title);

    const style = document.createElement('style');
    style.id = UI_STYLE_ID;
    style.textContent = `
        #${UI_ROOT_ID}{
            font-family: Arial, sans-serif;
            --bg: #ffffff;
            --text: #111827;
            --muted: #6b7280;
            --border: #d1d5db;
            --panel: #f9fafb;
            --btn-hover: #eef2ff;
            --table-header-bg: #f3f4f6;
            --table-row-alt: #fafafa;
            --table-row-hover: #eef2ff;
            --link: #1d4ed8;
            color-scheme: light dark;
            background: var(--bg);
            color: var(--text);
            padding: 0.9rem;
            box-sizing: border-box;
            min-height: 100vh;
        }
        @media (prefers-color-scheme: dark){
            #${UI_ROOT_ID}:not([data-theme]){
                --bg: #0b0f14;
                --text: #e5e7eb;
                --muted: #9ca3af;
                --border: #243041;
                --panel: #121826;
                --btn-hover: #1b2a44;
                --table-header-bg: #121826;
                --table-row-alt: #0f1522;
                --table-row-hover: #1b2a44;
                --link: #93c5fd;
            }
        }
        #${UI_ROOT_ID}[data-theme="light"]{ color-scheme: light; }
        #${UI_ROOT_ID}[data-theme="dark"]{ color-scheme: dark; }
        #${UI_ROOT_ID}[data-theme="dark"]{
            --bg: #0b0f14;
            --text: #e5e7eb;
            --muted: #9ca3af;
            --border: #243041;
            --panel: #121826;
            --btn-hover: #1b2a44;
            --table-header-bg: #121826;
            --table-row-alt: #0f1522;
            --table-row-hover: #1b2a44;
            --link: #93c5fd;
        }
        #${UI_ROOT_ID} a{color:var(--link);text-decoration:none;}
        #${UI_ROOT_ID} a:hover{cursor:pointer;text-decoration:underline;}
        #${UI_ROOT_ID} #${UI_ID_LOG} span{line-height:1.35;}
        #${UI_ROOT_ID} #${UI_ID_CONTROLS}{margin:0.75em 0 0.5em;display:flex;flex-wrap:wrap;gap:0.75em;align-items:flex-end;}
        #${UI_ROOT_ID} #${UI_ID_CONTROLS} .group{display:flex;flex-direction:column;gap:0.25em;min-width:12em;padding:0.5em;border:1px solid var(--border);border-radius:0.5em;background:var(--panel);}
        #${UI_ROOT_ID} #${UI_ID_CONTROLS} label{display:flex;gap:0.4em;align-items:center;user-select:none;}
        #${UI_ROOT_ID} #${UI_ID_CONTROLS} input[type="checkbox"]{accent-color:var(--link);}
        #${UI_ROOT_ID} #${UI_ID_CONTROLS} input[type="number"]{width:8em;border:1px solid var(--border);border-radius:0.45em;padding:0.2em 0.35em;background:var(--bg);color:var(--text);}
        #${UI_ROOT_ID} #${UI_ID_CONTROLS} input[type="search"]{width:12em;border:1px solid var(--border);border-radius:0.45em;padding:0.2em 0.35em;background:var(--bg);color:var(--text);}
        #${UI_ROOT_ID} #${UI_ID_CONTROLS} select{width:12em;border:1px solid var(--border);border-radius:0.45em;padding:0.25em 0.35em;background:var(--bg);color:var(--text);}
        #${UI_ROOT_ID} #${UI_ID_CONTROLS} button{padding:0.35em 0.65em;border:1px solid var(--border);border-radius:0.45em;background:transparent;color:var(--text);}
        #${UI_ROOT_ID} #${UI_ID_CONTROLS} button:hover{background:var(--btn-hover);}
        #${UI_ROOT_ID} #${UI_ID_CONTROLS} button:disabled{opacity:0.55;cursor:not-allowed;}
        #${UI_ROOT_ID} #${UI_ID_PROGRESS}{margin:0.4em 0 0.2em;color:var(--muted);}
        #${UI_ROOT_ID} #${UI_ID_TRUST}{margin:0.35em 0 0.65em;padding:0.6em 0.75em;border:1px solid var(--border);border-radius:0.6em;background:var(--panel);}
        #${UI_ROOT_ID} #${UI_ID_TRUST} .trust-head{display:flex;flex-wrap:wrap;gap:0.5em;align-items:center;justify-content:space-between;margin-bottom:0.35em;}
        #${UI_ROOT_ID} #${UI_ID_TRUST} .trust-metrics{display:flex;flex-wrap:wrap;gap:0.5em 0.9em;font-size:0.95em;}
        #${UI_ROOT_ID} #${UI_ID_TRUST} .trust-actions{display:flex;flex-wrap:wrap;gap:0.45em;margin-top:0.45em;}
        #${UI_ROOT_ID} #${UI_ID_SUMMARY}{margin:0.5em 0;color:var(--text);}
        #${UI_ROOT_ID} .pill{display:inline-block;padding:0.1em 0.4em;border-radius:0.4em;color:white;}
        #${UI_ROOT_ID} .muted{color:var(--muted);}
        #${UI_ROOT_ID} table{border-collapse:collapse;margin-top:0.75em;}
        #${UI_ROOT_ID} th, #${UI_ROOT_ID} td{border:1px solid var(--border);padding:0.25em 0.4em;vertical-align:top;}
        #${UI_ROOT_ID} thead th{position:sticky;top:0;background:var(--table-header-bg);z-index:2;}
        #${UI_ROOT_ID} thead th a{display:inline-flex;gap:0.25em;align-items:center;}
        #${UI_ROOT_ID} tbody tr:nth-child(even){background:var(--table-row-alt);}
        #${UI_ROOT_ID} tbody tr:hover{background:var(--table-row-hover);}
    `;
    try {
      document.getElementById(UI_STYLE_ID)?.remove();
    } catch {}
    document.head.appendChild(style);

    function appendLogMessage(target, message) {
      if (message == null) return;
      if (Array.isArray(message)) {
        for (const part of message) appendLogMessage(target, part);
        return;
      }
      if (message instanceof Node) {
        target.appendChild(message);
        return;
      }
      appendSimpleMarkup(target, message);
    }

    const logDiv = document.createElement('div');
    logDiv.id = UI_ID_LOG;
    appRoot.appendChild(logDiv);

    function addLog(msg) {
      const d = new Date();
      const span = document.createElement('span');
      const prefix = document.createElement('b');
      prefix.textContent =
        '[' +
        d.getHours().toString().padStart(2, '0') +
        ':' +
        d.getMinutes().toString().padStart(2, '0') +
        ':' +
        d.getSeconds().toString().padStart(2, '0') +
        '] - ';
      span.appendChild(prefix);
      appendLogMessage(span, msg);
      span.style.display = 'block';
      logDiv.appendChild(span);
      if (overlayEnabled) {
        appRoot.scrollTop = appRoot.scrollHeight;
      } else {
        globalThis.scroll(0, document.body.scrollHeight);
      }
    }

    function showInlineDialog({
      title,
      message,
      inputValue = '',
      confirmText = 'OK',
      cancelText = 'Cancel',
      withInput = false,
    }) {
      if (!overlayEnabled) {
        if (withInput) return Promise.resolve(prompt(title, inputValue));
        return Promise.resolve(confirm(`${title}\n\n${message || ''}`));
      }
      return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        Object.assign(backdrop.style, {
          position: 'fixed',
          inset: '0',
          zIndex: '2147483647',
          background: 'rgba(15,23,42,0.62)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        });
        const card = document.createElement('div');
        Object.assign(card.style, {
          width: 'min(520px, 100%)',
          background: 'var(--bg)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: '14px',
          padding: '18px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.24)',
        });
        const h = document.createElement('h3');
        h.textContent = title;
        h.style.margin = '0 0 8px';
        card.appendChild(h);
        if (message) {
          const p = document.createElement('p');
          p.textContent = message;
          p.style.margin = '0 0 12px';
          card.appendChild(p);
        }
        let input = null;
        if (withInput) {
          input = document.createElement('input');
          input.type = 'text';
          input.value = inputValue || '';
          Object.assign(input.style, {
            width: '100%',
            boxSizing: 'border-box',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '9px 10px',
            background: 'var(--bg)',
            color: 'var(--text)',
            marginBottom: '12px',
          });
          card.appendChild(input);
        }
        const actions = document.createElement('div');
        Object.assign(actions.style, {
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px',
        });
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = cancelText;
        const okBtn = document.createElement('button');
        okBtn.textContent = confirmText;
        for (const btn of [cancelBtn, okBtn]) {
          Object.assign(btn.style, {
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '8px 12px',
            background: 'transparent',
            color: 'var(--text)',
          });
        }
        okBtn.style.background = 'var(--btn-hover)';
        actions.appendChild(cancelBtn);
        actions.appendChild(okBtn);
        card.appendChild(actions);
        backdrop.appendChild(card);
        appRoot.appendChild(backdrop);

        function close(value) {
          backdrop.remove();
          resolve(value);
        }

        cancelBtn.addEventListener('click', () => close(withInput ? null : false));
        okBtn.addEventListener('click', () => close(withInput ? input.value : true));
        backdrop.addEventListener('click', (event) => {
          if (event.target === backdrop) close(withInput ? null : false);
        });
        if (input) {
          input.focus();
          input.select();
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') close(input.value);
            if (event.key === 'Escape') close(null);
          });
        }
      });
    }

    logScanStartContext({
      scanMode,
      config,
      pageLink,
      addLog,
      buildListPageLinkMessage,
    });

    const progressDiv = document.createElement('div');
    progressDiv.id = UI_ID_PROGRESS;
    appRoot.appendChild(progressDiv);

    const trustDiv = document.createElement('div');
    trustDiv.id = UI_ID_TRUST;
    appRoot.appendChild(trustDiv);

    const controlsDiv = document.createElement('div');
    controlsDiv.id = UI_ID_CONTROLS;
    appRoot.appendChild(controlsDiv);

    const summaryDiv = document.createElement('div');
    summaryDiv.id = UI_ID_SUMMARY;
    appRoot.appendChild(summaryDiv);

    let pageSize = config.pageSize;
    let totalProblems = null;
    let totalPages = scanMode === 'id-range' ? config.idRange.endId : null;
    let startedAt = Date.now();

    const stats = {
      solved: 0,
      tried: 0,
      unattempted: 0,
      total: 0,
      pages: 0,
      missing: 0,
      forbidden: 0,
    };
    let finished = false;
    let scanEnd = null;
    let restoringState = false;
    let stopRequested = false;
    let paused = false;
    let stopButton = null;
    let pauseButton = null;
    let retryUnknownsButton = null;
    let verifyButton = null;
    let resumeNowButton = null;
    const activeRequests = new Set();
    const activePageIndexes = new Set();
    const outcomeLedger = createOutcomeLedger();
    const verificationState = {
      enabled: globalThis.PBINFO_GET_UNSOLVED_VERIFY_UNSOLVED === true,
      running: false,
      completed: false,
      verifiedUnsolved: 0,
      reclassifiedSolved: 0,
      stillUnknown: 0,
      attempted: 0,
    };
    verificationState.enabled = resolveVerificationEnabled(
      verificationState.enabled,
      wizardVerifyUnsolved
    );
    let systemPauseReason = null;
    let systemPauseUntil = null;
    let systemPauseTimer = null;
    let unknownsPanel = null;
    let unknownsTableBody = null;
    let unknownsEmptyState = null;
    let unknownsToggleButton = null;
    let retrySelectedUnknownsButton = null;
    let forceRefreshInput = null;
    let navScopeSelect = null;
    let cacheInfoDiv = null;
    const navigationState = createNavigationState();

    const debugEnabled = Boolean(globalThis.PBINFO_GET_UNSOLVED_DEBUG);
    const debugDumpLimit = Number.isFinite(Number(globalThis.PBINFO_GET_UNSOLVED_DEBUG_LIMIT))
      ? Number(globalThis.PBINFO_GET_UNSOLVED_DEBUG_LIMIT)
      : 20;
    const debugIncludeHtml = Boolean(globalThis.PBINFO_GET_UNSOLVED_DEBUG_HTML);
    const debugIds = Array.isArray(globalThis.PBINFO_GET_UNSOLVED_DEBUG_IDS)
      ? new Set(
          globalThis.PBINFO_GET_UNSOLVED_DEBUG_IDS.map((n) => Number.parseInt(n, 10)).filter(
            Number.isFinite
          )
        )
      : null;
    let debugDumped = 0;

    if (debugEnabled) {
      const debugIdsSuffix = debugIds ? `, ids=${Array.from(debugIds).join(',')}` : '';
      addLog(
        `<span style="color:#b35c00;"><b>Debug:</b> activ (limită dump=${debugDumpLimit}${debugIdsSuffix}).</span>`
      );
    }

    function shouldDebugDump(id) {
      if (!debugEnabled) return false;
      if (debugDumped >= debugDumpLimit) return false;
      if (debugIds && !debugIds.has(id)) return false;
      return true;
    }

    function debugDumpCard(card, meta) {
      debugDumped++;

      const tooltipEls = Array.from(
        card.querySelectorAll(
          '[title],[data-bs-title],[data-bs-original-title],[data-original-title]'
        )
      );
      const tooltips = tooltipEls
        .map((el) => ({
          tag: el.tagName,
          tooltip: getTooltipText(el),
          text: normalizeSpace(el.textContent),
        }))
        .filter((x) => x.tooltip || x.text);

      const badges = Array.from(card.querySelectorAll('.badge'))
        .map((el) => normalizeSpace(el.textContent))
        .filter(Boolean);

      const candidates = (meta.scoreInfo?.candidates || []).map((c) => ({
        tag: c.el?.tagName,
        tooltip: c.tooltip,
        text: c.text,
        value: c.value,
        max: c.max,
        hasRatio: c.hasRatio,
      }));

      console.log('pbinfo-get-unsolved debug:', {
        id: meta.id,
        name: meta.name,
        link: meta.link,
        scoreInfo: { userScore: meta.scoreInfo?.userScore, maxScore: meta.scoreInfo?.maxScore },
        candidates,
        tooltips,
        badges,
      });

      if (debugIncludeHtml) {
        console.log('pbinfo-get-unsolved debug card html:', (card.outerHTML || '').slice(0, 5000));
      }
    }

    async function copyTextToClipboard(text) {
      const value = String(text || '');
      if (navigator?.clipboard?.writeText && globalThis.isSecureContext) {
        await navigator.clipboard.writeText(value);
        return { method: 'clipboard-api' };
      }
      const error = new Error('Clipboard API unavailable');
      error.code = 'clipboard-api-unavailable';
      error.isSecureContext = Boolean(globalThis.isSecureContext);
      throw error;
    }

    function describeClipboardError(err) {
      if (err?.isSecureContext === false) {
        return 'Context nesecurizat: Clipboard API modern cere HTTPS.';
      }
      if (err?.clipboardApiError?.name === 'NotAllowedError') {
        return 'Permisiune clipboard respinsă. Fă click în pagină și încearcă din nou.';
      }
      if (navigator?.clipboard?.writeText && globalThis.isSecureContext) {
        return 'Browserul a blocat accesul la clipboard. Încearcă din nou după interacțiune.';
      }
      return 'Clipboard indisponibil; folosește exportul și copiere manuală.';
    }

    const allProblems = [];
    const seenProblemIds = new Set();
    const sorted = {
      cnt: 1,
      id: 0,
      score: 0,
      status: 0,
      difficulty: 0,
      postedBy_name: 0,
      author: 0,
      source: 0,
    };

    const filterState = {
      statuses: new Set(['tried', 'unattempted']),
      qualities: new Set(['all']),
      includeUnknownScore: true,
      scoreMin: null,
      scoreMax: null,
      searchQuery: '',
    };

    const listDiv = document.createElement('div');
    listDiv.style.marginTop = '1em';

    const table = document.createElement('table');
    table.style.width = '75%';
    table.style.minWidth = '450px';
    table.style.maxWidth = '1050px';
    let tableRenderToken = 0;

    function ensureResultsAttached() {
      if (!table.isConnected) appRoot.appendChild(table);
      if (!listDiv.isConnected) appRoot.appendChild(listDiv);
    }

    function sortTable(type) {
      if (sorted[type] === 0) {
        Object.keys(sorted).forEach((k) => (sorted[k] = 0));
        sorted[type] = 1;
      } else {
        sorted[type] *= -1;
      }
      allProblems.sort((left, right) => compareSortableValues(left[type] ?? '', right[type] ?? ''));
      if (sorted[type] === -1) allProblems.reverse();
      renderResults();
    }

    globalThis.sortTable = sortTable;

    function getVisibleProblems() {
      const min = Number.isFinite(filterState.scoreMin) ? filterState.scoreMin : null;
      const max = Number.isFinite(filterState.scoreMax) ? filterState.scoreMax : null;
      const includeUnknown = Boolean(filterState.includeUnknownScore);
      const statuses = filterState.statuses;
      const query = normalizeForMatch(filterState.searchQuery || '');
      const qualityFiltered = filterProblemsByQuality(allProblems, filterState.qualities);

      return qualityFiltered.filter((p) => {
        if (!statuses.has(p.status)) return false;
        if (query) {
          const idText = Number.isFinite(p.id) ? String(p.id) : '';
          const nameText = normalizeForMatch(p.name || '');
          if (!idText.includes(query) && !nameText.includes(query)) return false;
        }
        const scoreKnown = p.userScore != null && Number.isFinite(p.userScore);
        if (!scoreKnown) return includeUnknown;
        if (min != null && p.userScore < min) return false;
        if (max != null && p.userScore > max) return false;
        return true;
      });
    }

    function getCoverageMetrics() {
      const scanStart = Math.max(1, Number.isFinite(config.startPage) ? config.startPage : 1);
      if (scanMode === 'id-range') {
        const expectedIds = Number.isFinite(config.idRange.endId)
          ? Math.max(0, config.idRange.endId - scanStart + 1)
          : null;
        const percent =
          expectedIds != null && expectedIds > 0
            ? Math.min(100, Math.round((stats.pages / expectedIds) * 100))
            : null;
        return {
          scannedPages: stats.pages,
          expectedPages: expectedIds,
          scannedProblems: stats.total,
          totalProblems: expectedIds,
          percent,
        };
      }

      const expectedPages = Number.isFinite(totalPages)
        ? Math.max(0, totalPages - scanStart + 1)
        : null;
      let totalExpectedProblems = null;
      if (Number.isFinite(totalProblems) && Number.isFinite(pageSize)) {
        totalExpectedProblems = Math.max(0, totalProblems - pageSize * (scanStart - 1));
      } else if (Number.isFinite(totalProblems)) {
        totalExpectedProblems = totalProblems;
      }
      const percent =
        expectedPages != null && expectedPages > 0
          ? Math.min(100, Math.round((stats.pages / expectedPages) * 100))
          : null;
      return {
        scannedPages: stats.pages,
        expectedPages,
        scannedProblems: stats.total,
        totalProblems: totalExpectedProblems,
        percent,
      };
    }

    function getVerificationMetrics() {
      return {
        enabled: verificationState.enabled,
        running: verificationState.running,
        completed: verificationState.completed,
        attempted: verificationState.attempted,
        verifiedUnsolved: verificationState.verifiedUnsolved,
        reclassifiedSolved: verificationState.reclassifiedSolved,
        stillUnknown: verificationState.stillUnknown,
      };
    }

    function getExportMetadata() {
      return {
        source: {
          scanMode,
          pageLink,
          exportedFilter: {
            statuses: Array.from(filterState.statuses),
            qualities: Array.from(filterState.qualities),
            includeUnknownScore: Boolean(filterState.includeUnknownScore),
            scoreMin: Number.isFinite(filterState.scoreMin) ? filterState.scoreMin : null,
            scoreMax: Number.isFinite(filterState.scoreMax) ? filterState.scoreMax : null,
            searchQuery: filterState.searchQuery || '',
          },
        },
        settings: {
          concurrency: config.concurrency,
          delayMs: config.delayMs,
          timeoutMs: config.timeoutMs,
          maxRetriesPerPage: config.maxRetriesPerPage,
          adaptiveThrottle: config.adaptiveThrottle,
          verifyUnsolved: verificationState.enabled,
          cacheEnabled: config.cache.enabled,
          cacheForceRefresh: config.cache.forceRefresh,
          cacheTtlMs: config.cache.ttlMs,
          navScope: config.navScope,
        },
        coverage: getCoverageMetrics(),
        reliability: summarizeOutcomeLedger(outcomeLedger),
        verification: getVerificationMetrics(),
      };
    }

    function updateTrustBar() {
      const coverage = getCoverageMetrics();
      const reliability = summarizeOutcomeLedger(outcomeLedger);
      const verification = getVerificationMetrics();
      const trustView = buildTrustMetricsView({
        coverage,
        reliability,
        verification,
        cacheConfig: config.cache,
        parsedCacheState,
        paused,
        systemPauseReason,
        systemPauseUntil,
        now: Date.now(),
        formatDuration,
      });
      const trustHead = document.createElement('div');
      trustHead.className = 'trust-head';
      const trustLabel = document.createElement('b');
      trustLabel.textContent = 'Trust';
      const trustCoverage = document.createElement('span');
      trustCoverage.className = 'muted';
      trustCoverage.textContent = `coverage ${trustView.percentText}${trustView.pauseText}`;
      trustHead.append(trustLabel, trustCoverage);

      const trustMetrics = document.createElement('div');
      trustMetrics.className = 'trust-metrics';
      for (const [label, value] of trustView.metricDefinitions) {
        const metric = document.createElement('span');
        const metricLabel = document.createTextNode(`${label}: `);
        const metricValue = document.createElement('b');
        metricValue.textContent = String(value);
        metric.append(metricLabel, metricValue);
        trustMetrics.appendChild(metric);
      }

      trustDiv.replaceChildren(trustHead, trustMetrics);
      if (unknownsToggleButton) {
        unknownsToggleButton.textContent = `Unknowns panel (${reliability.unknowns})`;
      }
      updateCacheInfoUi();
    }

    function updateCacheInfoUi() {
      refreshParsedCacheAvailability();
      if (!cacheInfoDiv) return;
      const namespaceLabel = parsedCacheState.userNamespace || 'nedetectat';
      let details = 'dezactivat';
      if (config.cache.enabled) {
        if (parsedCacheState.userNamespace) {
          if (config.cache.forceRefresh) details = 'force refresh';
          else if (parsedCacheState.persistenceEnabled) details = 'IndexedDB + memorie';
          else details = 'memorie sesiune';
        } else {
          details = 'live-only (fără user detectat)';
        }
      }
      cacheInfoDiv.textContent = `Cache: ${details} · TTL ${Math.round(
        config.cache.ttlMs / 60000
      )} min · user ${namespaceLabel}`;
    }

    function getRetryableUnknownEntries() {
      return listRetryableOutcomeEntries(outcomeLedger).sort((a, b) => {
        const updatedDelta = (b?.updatedAt || 0) - (a?.updatedAt || 0);
        if (updatedDelta !== 0) return updatedDelta;
        return String(a?.key || '').localeCompare(String(b?.key || ''));
      });
    }

    function setUnknownsPanelOpen(isOpen) {
      if (!unknownsPanel) return;
      const open = Boolean(isOpen);
      unknownsPanel.dataset.open = open ? 'true' : 'false';
      unknownsPanel.style.display = open ? 'flex' : 'none';
    }

    function updateSelectedUnknownsState() {
      if (!retrySelectedUnknownsButton || !unknownsTableBody) return;
      const checked = unknownsTableBody.querySelectorAll('input[data-outcome-key]:checked').length;
      retrySelectedUnknownsButton.disabled = checked === 0;
      retrySelectedUnknownsButton.textContent =
        checked > 0 ? `Retry selected (${checked})` : 'Retry selected';
    }

    function refreshUnknownsPanel() {
      if (!unknownsPanel || !unknownsTableBody || !unknownsEmptyState) return;
      const entries = getRetryableUnknownEntries();
      unknownsTableBody.replaceChildren();

      if (entries.length === 0) {
        unknownsEmptyState.style.display = '';
      } else {
        unknownsEmptyState.style.display = 'none';
        for (const entry of entries) {
          const row = document.createElement('tr');

          const tdSelect = document.createElement('td');
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.dataset.outcomeKey = entry.key;
          input.addEventListener('change', updateSelectedUnknownsState);
          tdSelect.appendChild(input);
          row.appendChild(tdSelect);

          const tdType = document.createElement('td');
          tdType.textContent = entry.targetType || '';
          row.appendChild(tdType);

          const tdTarget = document.createElement('td');
          tdTarget.textContent = String(entry.targetKey || '');
          row.appendChild(tdTarget);

          const tdStatus = document.createElement('td');
          tdStatus.textContent = formatOutcomeStatusLabel(entry.status);
          row.appendChild(tdStatus);

          const tdRetry = document.createElement('td');
          tdRetry.textContent = String(Number.isFinite(entry.retryCount) ? entry.retryCount : 0);
          row.appendChild(tdRetry);

          const tdUpdatedAt = document.createElement('td');
          tdUpdatedAt.textContent = Number.isFinite(entry.updatedAt)
            ? formatDateTime(entry.updatedAt)
            : '-';
          row.appendChild(tdUpdatedAt);

          unknownsTableBody.appendChild(row);
        }
      }

      updateSelectedUnknownsState();
    }

    function ensureRetrySessionActive() {
      if (!finished) return;
      finished = false;
      scanEnd = null;
      if (pauseButton) pauseButton.disabled = false;
      if (stopButton) stopButton.disabled = false;
    }

    function enqueueRetryTarget(targetType, targetKey) {
      if (targetType === 'verify-problem') {
        deferVerificationProblem(targetKey, 0);
        return true;
      }
      if (targetType === 'score-batch') {
        deferScoreBatch(targetKey, 0);
        return true;
      }
      if (targetType === 'list-page' || targetType === 'id-page') {
        deferPage(targetKey, 0);
        return true;
      }
      return false;
    }

    function requeueOutcomeEntries(entries) {
      const targets = buildOutcomeRetryTargets(entries);
      if (targets.length === 0) return 0;

      ensureRetrySessionActive();
      resumeFromSystemPause('');

      let retried = 0;
      for (const target of targets) {
        if (enqueueRetryTarget(target.targetType, target.targetKey)) {
          retried++;
        }
      }

      if (retried > 0) {
        updateTrustBar();
        refreshUnknownsPanel();
        for (let i = 0; i < getEffectiveConcurrency(); i++) schedule(kick);
      }
      return retried;
    }

    function retrySelectedUnknowns() {
      if (!unknownsTableBody) return;
      const selectedKeys = Array.from(
        unknownsTableBody.querySelectorAll('input[data-outcome-key]:checked')
      ).map((input) => input.dataset.outcomeKey);
      const entries = selectedKeys
        .map((key) => outcomeLedger.entries?.[key] || null)
        .filter(Boolean);
      const retried = requeueOutcomeEntries(entries);
      if (retried === 0) {
        addLog('Nu am găsit ținte selectate compatibile pentru retry.');
        return;
      }
      addLog(`Reiau ${retried} ținte necunoscute selectate.`);
    }

    function openNavigationProblem(mode) {
      const scope =
        normalizeSpace(navScopeSelect?.value || config.navScope || 'visible') === 'all'
          ? 'all'
          : 'visible';
      config.navScope = scope;
      const visibleProblems = getVisibleProblems();
      const selectedProblem =
        mode === 'random'
          ? pickRandomNavigationProblem(navigationState, {
              scope,
              visibleProblems,
              allProblems,
            })
          : pickNextNavigationProblem(navigationState, {
              scope,
              visibleProblems,
              allProblems,
            });
      if (!selectedProblem?.link) {
        addLog('Nu există probleme nerezolvate pentru navigare în scope-ul curent.');
        return;
      }
      globalThis.open(selectedProblem.link, '_blank', 'noopener,noreferrer');
      const navLabel = mode === 'random' ? 'Random' : 'Next';
      const problemNameSuffix = selectedProblem.name ? ` - ${selectedProblem.name}` : '';
      addLog(`${navLabel} unsolved: #${selectedProblem.id}${problemNameSuffix}.`);
    }

    function updateSummary(visible) {
      const shown = visible.length;
      const total = allProblems.length;
      const unsolved = allProblems.filter((p) => p.status !== 'solved').length;
      summaryDiv.replaceChildren();
      const b = document.createElement('b');
      b.textContent = 'Statistici:';
      summaryDiv.appendChild(b);
      summaryDiv.appendChild(
        document.createTextNode(
          ` scanate=${total} · nerezolvate=${unsolved} · afișate=${shown} · ${scanMode === 'id-range' ? 'ID-uri' : 'pagini'}=${stats.pages}`
        )
      );
    }

    function updateList(visible) {
      const tried = visible.filter((p) => p.status === 'tried');
      const unattempted = visible.filter((p) => p.status === 'unattempted');
      const solved = visible.filter((p) => p.status === 'solved');

      listDiv.replaceChildren();

      const h3 = document.createElement('h3');
      h3.textContent = 'Lista (filtrată):';
      listDiv.appendChild(h3);

      const counts = document.createElement('div');
      counts.style.marginBottom = '0.5em';
      counts.appendChild(document.createTextNode('Încercate: '));
      const triedB = document.createElement('b');
      triedB.textContent = String(tried.length);
      counts.appendChild(triedB);
      counts.appendChild(document.createTextNode(' · Neîncercate: '));
      const unattemptedB = document.createElement('b');
      unattemptedB.textContent = String(unattempted.length);
      counts.appendChild(unattemptedB);
      counts.appendChild(document.createTextNode(' · Rezolvate: '));
      const solvedB = document.createElement('b');
      solvedB.textContent = String(solved.length);
      counts.appendChild(solvedB);
      listDiv.appendChild(counts);

      const sections = [
        { label: 'Încercate', items: tried },
        { label: 'Neîncercate', items: unattempted },
        { label: 'Rezolvate', items: solved },
      ];
      for (const s of sections) {
        const h4 = document.createElement('h4');
        h4.style.margin = '0.75em 0 0.25em';
        h4.textContent = s.label;
        listDiv.appendChild(h4);
        listDiv.appendChild(buildProblemListNode(s.items));
      }
    }

    function renderResults() {
      const visible = getVisibleProblems();
      updateTable(visible);
      updateTrustBar();
      refreshUnknownsPanel();
      updateSummary(visible);
      updateList(visible);
    }

    let renderTimer = null;
    function requestRenderResults() {
      if (renderTimer != null) clearTimeout(renderTimer);
      renderTimer = setTimeout(() => {
        renderTimer = null;
        renderResults();
      }, 150);
    }

    const liveRenderConfig = createLiveRenderConfig(globalThis);
    let lastLiveRenderAt = 0;
    let lastLiveRenderPages = 0;

    function maybeLiveRender() {
      if (!liveRenderConfig.enabled) return;
      if (finished || stopRequested || restoringState) return;
      if (allProblems.length === 0) return;

      const now = Date.now();
      if (stats.pages - lastLiveRenderPages < liveRenderConfig.everyPages) return;
      if (now - lastLiveRenderAt < liveRenderConfig.minMs) return;

      lastLiveRenderAt = now;
      lastLiveRenderPages = stats.pages;
      ensureResultsAttached();
      requestRenderResults();
    }

    function downloadText(filename, content, mime) {
      const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      appRoot.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function recordRequestOutcome(outcome) {
      recordOutcomeEntry(outcomeLedger, outcome);
      updateTrustBar();
      refreshUnknownsPanel();
    }

    function clearSystemPauseTimer() {
      if (systemPauseTimer != null) {
        clearInterval(systemPauseTimer);
        systemPauseTimer = null;
      }
      systemPauseUntil = null;
    }

    function applyPauseUi() {
      if (pauseButton) {
        if (paused && systemPauseReason === 'rate-limit') pauseButton.textContent = 'Pauză (429)';
        else if (paused && systemPauseReason === 'challenge')
          pauseButton.textContent = 'Pauză (challenge)';
        else pauseButton.textContent = paused ? 'Continuă' : 'Pauză';
      }
      if (resumeNowButton) resumeNowButton.disabled = !(paused && systemPauseReason);
    }

    function resumeFromSystemPause(note) {
      const hadSystemPause = Boolean(systemPauseReason);
      clearSystemPauseTimer();
      systemPauseReason = null;
      paused = false;
      applyPauseUi();
      if (hadSystemPause && note) addLog(note);
      updateProgress(inFlight);
      if (!finished && !stopRequested) {
        for (let i = 0; i < getEffectiveConcurrency(); i++) schedule(kick);
      }
    }

    function enterSystemPause(reason, { delayMs = null, message = '' } = {}) {
      clearSystemPauseTimer();
      systemPauseReason = reason || 'system';
      paused = true;
      applyPauseUi();
      if (message) addLog(`<span style="color:#b35c00;"><b>Pauză:</b> ${message}</span>`);
      if (Number.isFinite(delayMs) && delayMs > 0) {
        systemPauseUntil = Date.now() + delayMs;
        systemPauseTimer = setInterval(() => {
          updateProgress(inFlight);
          if (systemPauseUntil != null && Date.now() >= systemPauseUntil) {
            resumeFromSystemPause('Scanare reluată automat.');
          }
        }, 250);
      }
      updateProgress(inFlight);
    }

    function retryUnknowns() {
      const entries = getRetryableUnknownEntries();
      if (entries.length === 0) {
        addLog('Nu există ținte necunoscute de reîncercat.');
        return;
      }
      const retried = requeueOutcomeEntries(entries);
      if (retried === 0) {
        addLog('Nu am găsit ținte compatibile pentru retry.');
        return;
      }
      addLog(`Reiau ${retried} ținte necunoscute.`);
    }

    function stopScan(reason) {
      if (finished) return;
      stopRequested = true;
      paused = false;
      clearSystemPauseTimer();
      systemPauseReason = null;
      if (pauseButton) {
        pauseButton.disabled = true;
        pauseButton.textContent = 'Pauză';
      }
      if (stopButton) {
        stopButton.disabled = true;
        stopButton.textContent = 'Oprit';
      }
      if (resumeNowButton) resumeNowButton.disabled = true;
      pageQueue.length = 0;
      for (const xhr of activeRequests) {
        try {
          xhr.abort();
        } catch {}
      }
      finishScan({ complete: false, reason: reason || 'Oprit de utilizator' });
    }

    async function closeOverlay() {
      if (!overlayEnabled) return;
      if (!finished && !stopRequested) {
        const ok = await showInlineDialog({
          title: 'Închizi overlay-ul?',
          message: 'Scanarea va fi oprită.',
          confirmText: 'Închide',
          cancelText: 'Rămâi',
        });
        if (!ok) return;
        stopScan('Oprit de utilizator');
      }
      try {
        document.getElementById(UI_ROOT_ID)?.remove();
      } catch {}
      try {
        document.getElementById(UI_STYLE_ID)?.remove();
      } catch {}
    }

    function togglePause() {
      if (finished || stopRequested) return;
      if (paused && systemPauseReason) {
        resumeFromSystemPause('Scanare reluată manual.');
        return;
      }
      const nextPaused = !paused;
      paused = nextPaused;
      applyPauseUi();
      addLog(nextPaused ? '<b>Scanare pusă pe pauză.</b>' : '<b>Scanare reluată.</b>');
      if (nextPaused) {
        ensureResultsAttached();
        renderResults();
        saveScanState({ mode: 'full', reason: 'pause', silent: true });
      }
      updateProgress(inFlight);
      if (!nextPaused) {
        for (let i = 0; i < getEffectiveConcurrency(); i++) schedule(kick);
      }
    }

    function setupControls() {
      const groupStatus = document.createElement('div');
      groupStatus.className = 'group';
      setGroupTitle(groupStatus, 'Stare');

      const statuses = [
        { key: 'solved', label: 'rezolvate' },
        { key: 'tried', label: 'încercate' },
        { key: 'unattempted', label: 'neîncercate' },
      ];

      for (const s of statuses) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = filterState.statuses.has(s.key);
        input.addEventListener('change', () => {
          if (input.checked) filterState.statuses.add(s.key);
          else filterState.statuses.delete(s.key);
          renderResults();
        });
        label.appendChild(input);
        label.appendChild(document.createTextNode(` ${s.label}`));
        groupStatus.appendChild(label);
      }

      const groupQuality = document.createElement('div');
      groupQuality.className = 'group';
      setGroupTitle(groupQuality, 'Calitate');
      const qualityInputs = new Map();
      const qualityOptions = [
        { key: 'all', label: 'toate' },
        { key: 'scan-only', label: 'scan only' },
        { key: 'verified', label: 'verified' },
        { key: 'verification-unknown', label: 'verification unknown' },
      ];

      const syncQualityInputs = () => {
        for (const [key, input] of qualityInputs.entries()) {
          input.checked = filterState.qualities.has(key);
        }
      };

      for (const option of qualityOptions) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = filterState.qualities.has(option.key);
        input.addEventListener('change', () => {
          if (option.key === 'all') {
            filterState.qualities.clear();
            filterState.qualities.add('all');
          } else {
            filterState.qualities.delete('all');
            if (input.checked) filterState.qualities.add(option.key);
            else filterState.qualities.delete(option.key);
            if (filterState.qualities.size === 0) filterState.qualities.add('all');
          }
          syncQualityInputs();
          requestRenderResults();
        });
        label.appendChild(input);
        label.appendChild(document.createTextNode(` ${option.label}`));
        groupQuality.appendChild(label);
        qualityInputs.set(option.key, input);
      }

      const groupScore = document.createElement('div');
      groupScore.className = 'group';
      setGroupTitle(groupScore, 'Filtru punctaj');

      const minLabel = document.createElement('label');
      minLabel.textContent = 'Min';
      const minInput = document.createElement('input');
      minInput.type = 'number';
      minInput.min = '0';
      minInput.placeholder = '-';
      if (filterState.scoreMin != null && Number.isFinite(filterState.scoreMin)) {
        minInput.value = String(filterState.scoreMin);
      }
      minInput.addEventListener('input', () => {
        const v = Number(minInput.value);
        filterState.scoreMin = Number.isFinite(v) && minInput.value !== '' ? v : null;
        requestRenderResults();
      });
      minLabel.appendChild(minInput);
      groupScore.appendChild(minLabel);

      const maxLabel = document.createElement('label');
      maxLabel.textContent = 'Max';
      const maxInput = document.createElement('input');
      maxInput.type = 'number';
      maxInput.min = '0';
      maxInput.placeholder = '-';
      if (filterState.scoreMax != null && Number.isFinite(filterState.scoreMax)) {
        maxInput.value = String(filterState.scoreMax);
      }
      maxInput.addEventListener('input', () => {
        const v = Number(maxInput.value);
        filterState.scoreMax = Number.isFinite(v) && maxInput.value !== '' ? v : null;
        requestRenderResults();
      });
      maxLabel.appendChild(maxInput);
      groupScore.appendChild(maxLabel);

      const unknownLabel = document.createElement('label');
      const unknownInput = document.createElement('input');
      unknownInput.type = 'checkbox';
      unknownInput.checked = filterState.includeUnknownScore;
      unknownInput.addEventListener('change', () => {
        filterState.includeUnknownScore = unknownInput.checked;
        renderResults();
      });
      unknownLabel.appendChild(unknownInput);
      unknownLabel.appendChild(document.createTextNode(' include scor necunoscut'));
      groupScore.appendChild(unknownLabel);

      const groupSearch = document.createElement('div');
      groupSearch.className = 'group';
      setGroupTitle(groupSearch, 'Căutare');

      const searchLabel = document.createElement('label');
      searchLabel.textContent = 'ID / nume';
      const searchInput = document.createElement('input');
      searchInput.type = 'search';
      searchInput.placeholder = 'ex: 123 sau graf';
      searchInput.value = filterState.searchQuery;
      searchInput.addEventListener('input', () => {
        filterState.searchQuery = searchInput.value || '';
        requestRenderResults();
      });
      searchLabel.appendChild(searchInput);
      groupSearch.appendChild(searchLabel);

      const groupAppearance = document.createElement('div');
      groupAppearance.className = 'group';
      setGroupTitle(groupAppearance, 'Aspect');

      const themeLabel = document.createElement('label');
      themeLabel.textContent = 'Temă';
      const themeSelect = document.createElement('select');
      const themeOptions = [
        { value: 'system', label: 'Sistem' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ];
      for (const o of themeOptions) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        themeSelect.appendChild(opt);
      }
      themeSelect.value = themePreference;
      themeSelect.addEventListener('change', () => {
        themePreference = applyThemePreference(themeSelect.value, appRoot, {
          localStorageApi,
          fallbackTarget: document.documentElement,
        });
        themeSelect.value = themePreference;
      });
      themeLabel.appendChild(themeSelect);
      groupAppearance.appendChild(themeLabel);

      const groupExport = document.createElement('div');
      groupExport.className = 'group';
      setGroupTitle(groupExport, 'Export');

      const exportCsv = document.createElement('button');
      exportCsv.textContent = 'CSV (filtrat)';
      exportCsv.addEventListener('click', () => {
        const visible = getVisibleProblems();
        downloadText('pbinfo-problems.csv', problemsToCsv(visible), 'text/csv;charset=utf-8');
      });
      groupExport.appendChild(exportCsv);

      const exportJson = document.createElement('button');
      exportJson.textContent = 'JSON (filtrat)';
      exportJson.addEventListener('click', () => {
        const visible = getVisibleProblems();
        const data = buildResultsExportPayload(visible, getExportMetadata());
        downloadText(
          'pbinfo-problems.json',
          JSON.stringify(data, null, 2),
          'application/json;charset=utf-8'
        );
      });
      groupExport.appendChild(exportJson);

      appendClipboardCopyButton({
        group: groupExport,
        buttonLabel: 'Copiază link-uri',
        onCopy: () =>
          copyVisibleProblemsToClipboard({
            getVisibleProblems,
            toText: problemsToLinksText,
            copyTextToClipboard,
            addLog,
            describeClipboardError,
            successItemLabel: 'link-uri',
            failureItemLabel: 'link-urile',
          }),
      });

      appendClipboardCopyButton({
        group: groupExport,
        buttonLabel: 'Copiază ID-uri',
        onCopy: () =>
          copyVisibleProblemsToClipboard({
            getVisibleProblems,
            toText: problemsToIdsText,
            copyTextToClipboard,
            addLog,
            describeClipboardError,
            successItemLabel: 'ID-uri',
            failureItemLabel: 'ID-urile',
          }),
      });

      appendClipboardCopyButton({
        group: groupExport,
        buttonLabel: 'Copiază Markdown',
        onCopy: () =>
          copyVisibleProblemsToClipboard({
            getVisibleProblems,
            toText: problemsToMarkdownText,
            copyTextToClipboard,
            addLog,
            describeClipboardError,
            successItemLabel: 'rânduri Markdown',
            failureItemLabel: 'Markdown',
          }),
      });

      const groupSession = document.createElement('div');
      groupSession.className = 'group';
      setGroupTitle(groupSession, 'Stare (local)');

      const stateSelectLabel = document.createElement('label');
      stateSelectLabel.textContent = 'Stare';
      const stateSelect = document.createElement('select');
      stateSelectLabel.appendChild(stateSelect);
      groupSession.appendChild(stateSelectLabel);

      const saveStateBtn = document.createElement('button');
      saveStateBtn.textContent = 'Snapshot';
      saveStateBtn.addEventListener('click', async () => {
        const label = await showInlineDialog({
          title: 'Etichetă snapshot',
          message: 'Poți lăsa câmpul gol.',
          inputValue: '',
          confirmText: 'Salvează',
          cancelText: 'Renunță',
          withInput: true,
        });
        if (label === null) return;
        // update "latest" state too (for quick restore)
        saveScanState({ mode: 'full', reason: 'manual', silent: true });
        const res = saveSnapshotItem({
          mode: 'full',
          label: normalizeSpace(label),
          reason: 'manual',
        });
        if (!res.ok) {
          addLog('<span style="color:#b30000;">Nu am putut salva snapshot-ul.</span>');
          refreshSessionInfo();
          return;
        }
        addLog(`Snapshot salvat (${res.storageLevel}).`);
        refreshSessionInfo();
      });
      groupSession.appendChild(saveStateBtn);

      const loadStateBtn = document.createElement('button');
      loadStateBtn.textContent = 'Încarcă';
      loadStateBtn.addEventListener('click', async () => {
        if (!paused && !finished) {
          addLog(
            '<span style="color:#b35c00;">Pune scanarea pe pauză înainte să încarci o stare.</span>'
          );
          return;
        }
        if (inFlight > 0) {
          addLog(
            '<span style="color:#b35c00;">Așteaptă să se termine request-urile în lucru înainte să încarci o stare.</span>'
          );
          return;
        }
        const ok = await showInlineDialog({
          title: 'Încarcă starea selectată?',
          message: 'Rezultatele curente vor fi înlocuite.',
          confirmText: 'Încarcă',
          cancelText: 'Renunță',
        });
        if (!ok) return;
        const selected = normalizeSpace(stateSelect.value);
        if (isSnapshotSelection(selected)) {
          const [storageVersionRaw, id] = selected.slice('snapshot:'.length).split(':');
          const storageVersion = Number.parseInt(storageVersionRaw, 10);
          const state = loadSnapshotItem(id, storageVersion);
          if (!state) {
            addLog('Snapshot inexistent (probabil șters).');
            refreshSessionInfo();
            return;
          }
          restoreFromSavedState(state, state.storageLevel === 'full' ? 'full' : 'minimal');
        } else {
          const loaded = loadSavedStateForLink();
          if (!loaded) {
            addLog('Nu există stare salvată pentru acest link.');
            refreshSessionInfo();
            return;
          }
          restoreFromSavedState(loaded.state, loaded.kind);
        }
        addLog('Stare încărcată.');
        refreshSessionInfo();
      });
      groupSession.appendChild(loadStateBtn);

      const clearStateBtn = document.createElement('button');
      clearStateBtn.textContent = 'Șterge';
      clearStateBtn.addEventListener('click', async () => {
        const selected = normalizeSpace(stateSelect.value);
        const selectedSnapshot = isSnapshotSelection(selected);
        const ok = await showInlineDialog({
          title: selectedSnapshot
            ? 'Ștergi snapshot-ul selectat?'
            : 'Ștergi starea autosave pentru acest link?',
          message: '',
          confirmText: 'Șterge',
          cancelText: 'Renunță',
        });
        if (!ok) return;
        if (selectedSnapshot) {
          const [, id] = selected.slice('snapshot:'.length).split(':');
          deleteSnapshotItem(id);
          addLog('Snapshot șters.');
        } else {
          clearSavedStateForLink();
          addLog('Stare ștearsă.');
        }
        refreshSessionInfo();
      });
      groupSession.appendChild(clearStateBtn);

      const exportStateBtn = document.createElement('button');
      exportStateBtn.textContent = 'Export JSON';
      exportStateBtn.addEventListener('click', () => {
        const selected = normalizeSpace(stateSelect.value);
        let state = null;
        let source = 'autosave';
        if (isSnapshotSelection(selected)) {
          const [storageVersionRaw, id] = selected.slice('snapshot:'.length).split(':');
          const storageVersion = Number.parseInt(storageVersionRaw, 10);
          state = loadSnapshotItem(id, storageVersion);
          source = `snapshot:${id}`;
        } else {
          state = loadSavedStateForLink()?.state || null;
        }
        if (!state) {
          addLog('<span style="color:#b30000;">Nu am găsit nicio stare de exportat.</span>');
          return;
        }
        const payload = {
          type: 'pbinfo-get-unsolved-snapshot',
          exportVersion: 1,
          exportedAt: Date.now(),
          source,
          state: migrateStateSnapshotToV2(state),
        };
        downloadText(
          `pbinfo-state-${Date.now()}.json`,
          JSON.stringify(payload, null, 2),
          'application/json;charset=utf-8'
        );
        addLog('Snapshot exportat în fișier JSON.');
      });
      groupSession.appendChild(exportStateBtn);

      const importStateInput = document.createElement('input');
      importStateInput.type = 'file';
      importStateInput.accept = 'application/json,.json';
      importStateInput.style.display = 'none';
      groupSession.appendChild(importStateInput);

      const importStateBtn = document.createElement('button');
      importStateBtn.textContent = 'Import JSON';
      importStateBtn.addEventListener('click', () => {
        importStateInput.click();
      });
      importStateInput.addEventListener('change', async () => {
        const file = importStateInput.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = safeJsonParse(text);
          const imported = extractSnapshotFromImport(parsed);
          if (!imported) {
            addLog(
              '<span style="color:#b30000;">Fișier JSON invalid pentru import snapshot.</span>'
            );
            return;
          }

          if (imported.pageLink && imported.pageLink !== pageLink) {
            const ok = await showInlineDialog({
              title: 'Snapshot pentru alt link',
              message: `Link snapshot: ${imported.pageLink}\nLink curent: ${pageLink}\n\nVrei să-l remapezi pe link-ul curent?`,
              confirmText: 'Remapează',
              cancelText: 'Renunță',
            });
            if (!ok) return;
          }

          imported.pageLink = pageLink;
          const labelFromFile = normalizeSpace(imported.label || file.name.replace(/\.[^.]+$/, ''));
          const res = saveImportedSnapshot(imported, { label: labelFromFile || 'import' });
          if (!res.ok) {
            addLog(
              '<span style="color:#b30000;">Import eșuat: nu am putut salva snapshot-ul.</span>'
            );
            refreshSessionInfo();
            return;
          }
          addLog(`Snapshot importat (${res.storageLevel}).`);
          refreshSessionInfo();
        } catch (err) {
          addLog('<span style="color:#b30000;">Import eșuat: fișierul nu a putut fi citit.</span>');
          console.error(err);
        } finally {
          importStateInput.value = '';
        }
      });
      groupSession.appendChild(importStateBtn);

      const clearCacheBtn = document.createElement('button');
      clearCacheBtn.textContent = 'Clear cache';
      clearCacheBtn.addEventListener('click', async () => {
        const ok = await showInlineDialog({
          title: 'Ștergi cache-ul parse-uit?',
          message: 'Se vor șterge scorurile/verificările memorate local pentru userul detectat.',
          confirmText: 'Șterge',
          cancelText: 'Renunță',
        });
        if (!ok) return;
        const cleared = await clearParsedCache();
        addLog(
          cleared
            ? 'Cache parse-uit șters.'
            : '<span style="color:#b30000;">Nu am putut șterge cache-ul.</span>'
        );
        updateTrustBar();
      });
      groupSession.appendChild(clearCacheBtn);

      const sessionInfo = document.createElement('div');
      sessionInfo.className = 'muted';
      groupSession.appendChild(sessionInfo);

      cacheInfoDiv = document.createElement('div');
      cacheInfoDiv.className = 'muted';
      groupSession.appendChild(cacheInfoDiv);

      function showNoSessionStateOption() {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '— fără stări salvate —';
        stateSelect.appendChild(opt);
        stateSelect.disabled = true;
        loadStateBtn.disabled = true;
        clearStateBtn.disabled = true;
        exportStateBtn.disabled = true;
        sessionInfo.textContent = 'Nicio stare salvată.';
      }

      function refreshSessionInfo() {
        const selectedBefore = normalizeSpace(stateSelect.value);
        stateSelect.replaceChildren();

        const latest = loadSavedStateForLink();
        const snapshots = loadSnapshotIndexForLink();

        const options = [];
        appendLatestSessionOption(options, latest);
        appendSnapshotSessionOptions(options, snapshots);

        if (options.length === 0) {
          showNoSessionStateOption();
          return;
        }

        stateSelect.disabled = false;
        for (const o of options) {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = o.label;
          stateSelect.appendChild(opt);
        }

        const prefer = options.some((o) => o.value === selectedBefore)
          ? selectedBefore
          : options[0].value;
        stateSelect.value = prefer;

        loadStateBtn.disabled = false;
        clearStateBtn.disabled = false;
        exportStateBtn.disabled = false;
        sessionInfo.textContent = `Stări salvate: ${options.length}.`;
      }

      const groupScan = document.createElement('div');
      groupScan.className = 'group';
      setGroupTitle(groupScan, 'Scan');

      pauseButton = document.createElement('button');
      pauseButton.textContent = 'Pauză';
      pauseButton.addEventListener('click', togglePause);
      groupScan.appendChild(pauseButton);

      stopButton = document.createElement('button');
      stopButton.textContent = 'Stop scan';
      stopButton.addEventListener('click', () => stopScan('Oprit de utilizator'));
      groupScan.appendChild(stopButton);

      retryUnknownsButton = document.createElement('button');
      retryUnknownsButton.textContent = 'Retry unknowns';
      retryUnknownsButton.addEventListener('click', retryUnknowns);
      groupScan.appendChild(retryUnknownsButton);

      verifyButton = document.createElement('button');
      verifyButton.textContent = verificationState.enabled
        ? 'Verify unsolved: on'
        : 'Verify unsolved: off';
      verifyButton.addEventListener('click', () => {
        verificationState.enabled = !verificationState.enabled;
        verifyButton.textContent = verificationState.enabled
          ? 'Verify unsolved: on'
          : 'Verify unsolved: off';
        updateTrustBar();
      });
      groupScan.appendChild(verifyButton);

      const forceRefreshLabel = document.createElement('label');
      forceRefreshInput = document.createElement('input');
      forceRefreshInput.type = 'checkbox';
      forceRefreshInput.checked = config.cache.forceRefresh;
      forceRefreshInput.addEventListener('change', () => {
        config.cache.forceRefresh = forceRefreshInput.checked;
        updateTrustBar();
        requestRenderResults();
      });
      forceRefreshLabel.appendChild(forceRefreshInput);
      forceRefreshLabel.appendChild(document.createTextNode(' force refresh'));
      groupScan.appendChild(forceRefreshLabel);

      resumeNowButton = document.createElement('button');
      resumeNowButton.textContent = 'Resume now';
      resumeNowButton.disabled = true;
      resumeNowButton.addEventListener('click', () =>
        resumeFromSystemPause('Scanare reluată manual.')
      );
      groupScan.appendChild(resumeNowButton);

      unknownsToggleButton = document.createElement('button');
      unknownsToggleButton.textContent = 'Unknowns panel (0)';
      unknownsToggleButton.addEventListener('click', () => {
        setUnknownsPanelOpen(unknownsPanel?.dataset.open !== 'true');
      });
      groupScan.appendChild(unknownsToggleButton);

      if (overlayEnabled) {
        const closeOverlayBtn = document.createElement('button');
        closeOverlayBtn.textContent = 'Închide overlay';
        closeOverlayBtn.addEventListener('click', () => {
          closeOverlay();
        });
        groupScan.appendChild(closeOverlayBtn);
      }

      const scanNote = document.createElement('div');
      scanNote.className = 'muted';
      scanNote.textContent =
        scanMode === 'id-range'
          ? `resume: start ID > ${config.idRange.startId} (curent ${config.startPage}) · interval=${config.idRange.startId}-${config.idRange.endId}`
          : `resume: start page > 1 (curent ${config.startPage}) · maxPages=${config.maxPages}`;
      groupScan.appendChild(scanNote);

      const groupNavigation = document.createElement('div');
      groupNavigation.className = 'group';
      setGroupTitle(groupNavigation, 'Navigare');

      const navScopeLabel = document.createElement('label');
      navScopeLabel.textContent = 'Scope';
      navScopeSelect = document.createElement('select');
      const navScopes = [
        { value: 'visible', label: 'visible unsolved' },
        { value: 'all', label: 'all unsolved' },
      ];
      for (const option of navScopes) {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        navScopeSelect.appendChild(opt);
      }
      navScopeSelect.value = config.navScope === 'all' ? 'all' : 'visible';
      navScopeSelect.addEventListener('change', () => {
        config.navScope = navScopeSelect.value === 'all' ? 'all' : 'visible';
      });
      navScopeLabel.appendChild(navScopeSelect);
      groupNavigation.appendChild(navScopeLabel);

      const openNextBtn = document.createElement('button');
      openNextBtn.textContent = 'Open next unsolved';
      openNextBtn.addEventListener('click', () => openNavigationProblem('next'));
      groupNavigation.appendChild(openNextBtn);

      const openRandomBtn = document.createElement('button');
      openRandomBtn.textContent = 'Open random unsolved';
      openRandomBtn.addEventListener('click', () => openNavigationProblem('random'));
      groupNavigation.appendChild(openRandomBtn);

      unknownsPanel = document.createElement('div');
      unknownsPanel.className = 'group';
      unknownsPanel.style.flex = '1 1 100%';
      unknownsPanel.style.minWidth = '100%';
      unknownsPanel.style.display = 'none';
      unknownsPanel.dataset.open = 'false';

      const unknownsTitle = document.createElement('div');
      setGroupTitle(unknownsTitle, 'Unknown targets');
      unknownsPanel.appendChild(unknownsTitle);

      const unknownsActions = document.createElement('div');
      unknownsActions.style.display = 'flex';
      unknownsActions.style.flexWrap = 'wrap';
      unknownsActions.style.gap = '0.45em';

      retrySelectedUnknownsButton = document.createElement('button');
      retrySelectedUnknownsButton.textContent = 'Retry selected';
      retrySelectedUnknownsButton.disabled = true;
      retrySelectedUnknownsButton.addEventListener('click', retrySelectedUnknowns);
      unknownsActions.appendChild(retrySelectedUnknownsButton);

      const hideUnknownsButton = document.createElement('button');
      hideUnknownsButton.textContent = 'Ascunde';
      hideUnknownsButton.addEventListener('click', () => setUnknownsPanelOpen(false));
      unknownsActions.appendChild(hideUnknownsButton);
      unknownsPanel.appendChild(unknownsActions);

      unknownsEmptyState = document.createElement('div');
      unknownsEmptyState.className = 'muted';
      unknownsEmptyState.textContent = 'Nicio țintă necunoscută de reîncercat.';
      unknownsPanel.appendChild(unknownsEmptyState);

      const unknownsTable = document.createElement('table');
      unknownsTable.style.width = '100%';
      const unknownsHead = document.createElement('thead');
      const unknownsHeadRow = document.createElement('tr');
      for (const label of ['Select', 'Tip', 'Țintă', 'Ultim status', 'Retry', 'Actualizat']) {
        const th = document.createElement('th');
        th.textContent = label;
        unknownsHeadRow.appendChild(th);
      }
      unknownsHead.appendChild(unknownsHeadRow);
      unknownsTable.appendChild(unknownsHead);
      unknownsTableBody = document.createElement('tbody');
      unknownsTable.appendChild(unknownsTableBody);
      unknownsPanel.appendChild(unknownsTable);

      controlsDiv.replaceChildren(
        groupStatus,
        groupQuality,
        groupScore,
        groupSearch,
        groupAppearance,
        groupExport,
        groupSession,
        groupScan,
        groupNavigation,
        unknownsPanel
      );
      refreshSessionInfo();
      updateCacheInfoUi();
      refreshUnknownsPanel();
      setUnknownsPanelOpen(false);
    }

    function updateProgress(inFlight) {
      progressDiv.textContent = buildProgressText({
        scanMode,
        now: Date.now(),
        startedAt,
        config,
        paused,
        inFlight,
        stats,
        totalPages,
        totalProblems,
        pageSize,
        adaptiveEnabled: adaptiveThrottleState.enabled,
        effectiveDelayMs: getEffectiveDelayMs(),
        effectiveConcurrency: getEffectiveConcurrency(),
      });
      updateTrustBar();
    }

    setupControls();
    renderResults();
    updateProgress(0);

    function updateTable(visibleProblems) {
      const renderToken = ++tableRenderToken;
      table.replaceChildren();
      const thead = document.createElement('thead');
      const tbody = document.createElement('tbody');
      table.appendChild(thead);
      table.appendChild(tbody);

      const headerDefs = [
        { key: 'cnt', label: 'Contor', minWidth: '5em' },
        { key: 'id', label: 'Nume', minWidth: '10em' },
        { key: 'score', label: 'Punctaj', minWidth: '5em' },
        { key: 'status', label: 'Stare', minWidth: '7.5em' },
        { key: 'difficulty', label: 'Dificultate', minWidth: '6.5em' },
        { key: 'postedBy_name', label: 'Postată de', minWidth: '13em' },
        { key: 'author', label: 'Autor', minWidth: '10em' },
        { key: 'source', label: 'Sursa problemei', minWidth: '10em' },
      ];

      const headRow = document.createElement('tr');
      for (const h of headerDefs) {
        const th = document.createElement('th');
        th.style.minWidth = h.minWidth;
        th.style.userSelect = 'none';
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = `${h.label} ${sortSymbol(sorted, h.key)}`;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          sortTable(h.key);
        });
        th.appendChild(a);
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);

      const listAll = Array.isArray(visibleProblems) ? visibleProblems : getVisibleProblems();
      const chunkSize = Math.max(
        25,
        Number.isFinite(config.tableRenderChunkSize) ? config.tableRenderChunkSize : 150
      );
      const shouldVirtualize =
        config.virtualizeRows &&
        Number.isFinite(config.virtualRowsLimit) &&
        listAll.length > config.virtualRowsLimit;
      const list = shouldVirtualize ? listAll.slice(0, config.virtualRowsLimit) : listAll;
      const scheduleChunk =
        typeof globalThis.requestAnimationFrame === 'function'
          ? globalThis.requestAnimationFrame.bind(globalThis)
          : (fn) => setTimeout(fn, 16);

      const buildRow = (p, i) => {
        const row = document.createElement('tr');

        const tdCnt = document.createElement('td');
        tdCnt.textContent = `${i + 1}.`;
        row.appendChild(tdCnt);

        const tdName = document.createElement('td');
        const nameA = document.createElement('a');
        nameA.href = p.link;
        nameA.target = '_blank';
        nameA.rel = 'noopener noreferrer';
        nameA.textContent = p.name ? `#${p.id} - ${p.name}` : `#${p.id}`;
        tdName.appendChild(nameA);
        row.appendChild(tdName);

        const tdScore = document.createElement('td');
        tdScore.textContent =
          p.userScore != null && Number.isFinite(p.userScore) ? `${p.userScore}p` : '-';
        row.appendChild(tdScore);

        const tdStatus = document.createElement('td');
        const statusSpan = document.createElement('span');
        statusSpan.className = 'pill';
        statusSpan.style.backgroundColor = `#${statusColor(p.status)}`;
        statusSpan.textContent = statusLabel(p.status);
        tdStatus.appendChild(statusSpan);
        tdStatus.appendChild(document.createTextNode(' '));
        const qualitySpan = document.createElement('span');
        qualitySpan.className = 'pill';
        qualitySpan.style.backgroundColor = `#${qualityColor(p.quality)}`;
        qualitySpan.textContent = qualityLabel(p.quality);
        tdStatus.appendChild(qualitySpan);
        row.appendChild(tdStatus);

        const tdDifficulty = document.createElement('td');
        const diffSpan = document.createElement('span');
        diffSpan.className = 'pill';
        diffSpan.style.backgroundColor = `#${difficultyColor(p.difficulty)}`;
        diffSpan.textContent = numberToDifficulty(p.difficulty);
        tdDifficulty.appendChild(diffSpan);
        row.appendChild(tdDifficulty);

        const tdPostedBy = document.createElement('td');
        if (p.postedBy_link) {
          const pbA = document.createElement('a');
          pbA.href = p.postedBy_link;
          pbA.target = '_blank';
          pbA.rel = 'noopener noreferrer';
          if (p.postedBy_img) {
            const img = document.createElement('img');
            img.style.verticalAlign = 'middle';
            img.style.width = '1.1em';
            img.src = p.postedBy_img;
            img.alt = '';
            pbA.appendChild(img);
            pbA.appendChild(document.createTextNode(' '));
          }
          pbA.appendChild(document.createTextNode(p.postedBy_name || ''));
          tdPostedBy.appendChild(pbA);
        }
        row.appendChild(tdPostedBy);

        const tdAuthor = document.createElement('td');
        tdAuthor.textContent = p.author || '';
        row.appendChild(tdAuthor);

        const tdSource = document.createElement('td');
        tdSource.textContent = p.source || '';
        row.appendChild(tdSource);

        return row;
      };

      let idx = 0;
      const renderChunk = () => {
        if (renderToken !== tableRenderToken) return;
        const frag = document.createDocumentFragment();
        const end = Math.min(list.length, idx + chunkSize);
        for (; idx < end; idx++) {
          frag.appendChild(buildRow(list[idx], idx));
        }
        tbody.appendChild(frag);

        if (idx < list.length) {
          scheduleChunk(renderChunk);
          return;
        }

        if (shouldVirtualize) {
          const row = document.createElement('tr');
          const td = document.createElement('td');
          td.colSpan = headerDefs.length;
          td.className = 'muted';
          td.textContent = `Virtualizare activă: afișez primele ${list.length} din ${listAll.length} rânduri. Filtrează/caută pentru restul.`;
          row.appendChild(td);
          tbody.appendChild(row);
        }
      };

      renderChunk();
    }

    function shouldStartVerificationBeforeFinish(complete) {
      if (!complete) return false;
      if (!verificationState.enabled) return false;
      if (verificationState.running || verificationState.completed) return false;
      return allProblems.some((p) => p.status !== 'solved');
    }

    function disableScanControlsAfterFinish() {
      if (pauseButton) pauseButton.disabled = true;
      if (stopButton) stopButton.disabled = true;
    }

    function buildFinishSummarySuffix() {
      if (scanMode !== 'id-range') return '';
      const parts = [];
      if (stats.missing > 0) parts.push(`404 ${stats.missing}`);
      if (stats.forbidden > 0) parts.push(`403 ${stats.forbidden}`);
      if (parts.length === 0) return '';
      return `, ${parts.join(', ')}`;
    }

    function logFinishSummary() {
      const unitLabel = scanMode === 'id-range' ? 'ID-uri' : 'pagini';
      const idRangeSuffix = buildFinishSummarySuffix();
      addLog(
        `Rezumat: ${stats.solved} rezolvate, ${stats.tried} încercate, ${stats.unattempted} neîncercate (total ${stats.total}, ${unitLabel} ${stats.pages}${idRangeSuffix}).`
      );
    }

    function logCompleteFinishMessage() {
      const unsolvedCount = allProblems.filter((p) => p.status !== 'solved').length;
      addLog(
        `<u>Am terminat de extras problemele.</u> Sunt ${unsolvedCount} probleme nerezolvate. Tabelul și lista au fost adăugate mai jos.`
      );
      saveScanState({ mode: 'full', reason: 'complete', silent: true });
    }

    function logStoppedFinishMessage(reason) {
      const reasonText = reason ? ` <span style="color:#b30000;">(${reason})</span>` : '';
      addLog(
        `<span style="color:#b30000;"><u>Scanarea s-a oprit înainte de final.</u></span>${reasonText}`
      );
      saveScanState({ mode: 'full', reason: 'stopped', silent: true });
    }

    function finishScan({ complete, reason }) {
      if (finished) return;
      if (shouldStartVerificationBeforeFinish(complete)) {
        startVerificationPass();
        return;
      }
      scanEnd = {
        finished: true,
        complete: Boolean(complete),
        reason: reason ? String(reason) : null,
        endedAt: Date.now(),
      };
      finished = true;
      disableScanControlsAfterFinish();

      ensureResultsAttached();
      renderResults();
      logFinishSummary();

      if (complete) {
        logCompleteFinishMessage();
      } else {
        logStoppedFinishMessage(reason);
      }
    }

    // Fetch pages (optional concurrency)
    const maxRetriesPerPage = config.maxRetriesPerPage;
    const pageQueue = [];
    const deferredPageRequests = new Map();
    const deferredScoreBatchRequests = new Map();
    const deferredVerificationRequests = new Map();
    let nextSequentialPage = null;
    let queueInitialized = false;
    let inFlight = 0;
    let idRangeConsecutiveMissing = 0;
    let idRangeWarnedAboutScore = false;
    let idRangeWarnedAboutForbidden = false;
    const idRangeLogEvery = resolveIdRangeLogEvery(globalThis);
    const idRangeScoreCache = new Map();
    const idRangeScoreBatchInFlight = new Set();
    const idRangeScoreBatchFailed = new Set();
    let idRangeWarnedAboutScoreBatch = false;

    const autosaveConfig = createAutosaveConfig(globalThis);
    const snapshotConfig = createSnapshotConfig(globalThis);
    let lastAutosaveAt = 0;
    let lastAutosavePages = 0;
    let autosaveDisabled = false;
    const storagePolicy = {
      progressOnly: false,
      lastErrorType: null,
    };
    let storageWarned = false;

    function noteStorageFailure(errorType, contextLabel) {
      storagePolicy.lastErrorType = errorType || 'unknown';
      if (errorType === 'quota') storagePolicy.progressOnly = true;
      if (storageWarned) return;
      storageWarned = true;
      const reason =
        errorType === 'quota'
          ? 'spațiu localStorage insuficient (quota)'
          : 'scriere localStorage eșuată';
      const contextSuffix = contextLabel ? ` (${contextLabel})` : '';
      addLog(
        `<span style="color:#b35c00;"><b>Stocare:</b> ${reason}${contextSuffix}. Continui în mod degradat.</span>`
      );
    }

    function loadSavedStateForLink() {
      const full = migrateStateSnapshotToV2(storageGetJson([stateKeys.full, legacyStateKeys.full]));
      if (full && full.pageLink === pageLink) return { kind: 'full', state: full };
      const minimal = migrateStateSnapshotToV2(
        storageGetJson([stateKeys.minimal, legacyStateKeys.minimal])
      );
      if (minimal && minimal.pageLink === pageLink) return { kind: 'minimal', state: minimal };
      return null;
    }

    function clearSavedStateForLink() {
      storageRemove([
        stateKeys.full,
        stateKeys.minimal,
        legacyStateKeys.full,
        legacyStateKeys.minimal,
      ]);
    }

    function snapshotItemKey(id, storageVersion = STATE_STORAGE_VERSION) {
      const key = normalizeSpace(id);
      if (!key) return null;
      const keys = storageVersion === LEGACY_STATE_STORAGE_VERSION ? legacyStateKeys : stateKeys;
      return `${keys.itemPrefix}${key}`;
    }

    function normalizeSnapshotStorageVersion(storageVersion) {
      if (Number(storageVersion) === LEGACY_STATE_STORAGE_VERSION) {
        return LEGACY_STATE_STORAGE_VERSION;
      }
      return STATE_STORAGE_VERSION;
    }

    function normalizeSnapshotIndexItem(item) {
      const id = normalizeSpace(item?.id);
      if (!id) return null;
      const savedAt = Number(item?.savedAt);
      return {
        id,
        savedAt: Number.isFinite(savedAt) ? savedAt : null,
        storageLevel: normalizeSnapshotStorageLevel(item?.storageLevel),
        label: typeof item?.label === 'string' ? item.label : '',
        storageVersion: normalizeSnapshotStorageVersion(item?.storageVersion),
      };
    }

    function normalizeSnapshotIndex(index) {
      const raw = Array.isArray(index) ? index : [];
      const out = [];
      for (const item of raw) {
        const normalizedItem = normalizeSnapshotIndexItem(item);
        if (!normalizedItem) continue;
        out.push(normalizedItem);
      }
      out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      return out;
    }

    function loadSnapshotIndexForLink() {
      const current = normalizeSnapshotIndex(storageGetJson(stateKeys.index)).map((entry) => ({
        ...entry,
        storageVersion: STATE_STORAGE_VERSION,
      }));
      const legacy = normalizeSnapshotIndex(storageGetJson(legacyStateKeys.index)).map((entry) => ({
        ...entry,
        storageVersion: LEGACY_STATE_STORAGE_VERSION,
      }));
      const byId = new Map();
      for (const entry of [...current, ...legacy]) {
        if (!byId.has(entry.id)) byId.set(entry.id, entry);
      }
      return normalizeSnapshotIndex(Array.from(byId.values()));
    }

    function writeSnapshotIndexForLink(index) {
      const normalized = normalizeSnapshotIndex(index);
      return storageSetJson(stateKeys.index, normalized);
    }

    function loadSnapshotItem(id, storageVersion = null) {
      const versions = Number(storageVersion)
        ? [Number(storageVersion)]
        : [STATE_STORAGE_VERSION, LEGACY_STATE_STORAGE_VERSION];
      for (const version of versions) {
        const key = snapshotItemKey(id, version);
        if (!key) continue;
        const v = migrateStateSnapshotToV2(storageGetJson(key));
        if (v && v.pageLink === pageLink) return v;
      }
      return null;
    }

    function deleteSnapshotItem(id) {
      const keyCurrent = snapshotItemKey(id, STATE_STORAGE_VERSION);
      const keyLegacy = snapshotItemKey(id, LEGACY_STATE_STORAGE_VERSION);
      storageRemove([keyCurrent, keyLegacy]);
      const idx = loadSnapshotIndexForLink().filter((x) => x.id !== id);
      const writeRes = writeSnapshotIndexForLink(idx);
      if (!writeRes.ok) {
        noteStorageFailure(writeRes.errorType, 'index');
        return false;
      }
      return true;
    }

    function pruneSnapshotIndex(index) {
      const max = Number.isFinite(snapshotConfig.maxEntries) ? snapshotConfig.maxEntries : 8;
      const list = normalizeSnapshotIndex(index);
      const { pruned, staleKeys } = pruneSnapshotEntries(list, {
        maxEntries: max,
        snapshotItemKey,
        storageHasValue,
      });
      if (staleKeys.length > 0) {
        storageRemove(staleKeys);
      }
      return pruned;
    }

    function saveSnapshotItem({ mode, label, reason } = {}) {
      const id = createSnapshotId();
      const key = snapshotItemKey(id, STATE_STORAGE_VERSION);
      if (!key) return { ok: false, id: null, storageLevel: null };

      const desired = mode === 'minimal' || mode === 'progress' ? mode : 'full';
      const levels = desired === 'full' ? ['full', 'minimal', 'progress'] : ['minimal', 'progress'];

      for (const level of levels) {
        const snap = buildStateSnapshot(level, reason || 'snapshot');
        if (label) snap.label = String(label);
        const writeSnapshotRes = storageSetJson(key, snap);
        if (!writeSnapshotRes.ok) {
          noteStorageFailure(writeSnapshotRes.errorType, 'snapshot');
          continue;
        }

        const idx = pruneSnapshotIndex([
          {
            id,
            savedAt: snap.savedAt,
            storageLevel: snap.storageLevel,
            label: snap.label || '',
            storageVersion: STATE_STORAGE_VERSION,
          },
          ...loadSnapshotIndexForLink(),
        ]);
        const writeIdxRes = writeSnapshotIndexForLink(idx);
        if (!writeIdxRes.ok) {
          storageRemove(key);
          noteStorageFailure(writeIdxRes.errorType, 'index');
          return { ok: false, id: null, storageLevel: null };
        }
        return { ok: true, id, storageLevel: snap.storageLevel };
      }

      storageRemove(key);
      return { ok: false, id: null, storageLevel: null };
    }

    function projectSnapshotForLevel(snapshot, level) {
      const migrated = migrateStateSnapshotToV2(snapshot);
      if (!migrated) return null;
      const projectedLevel =
        level === 'full' || level === 'minimal' || level === 'progress' ? level : 'minimal';
      const out = {
        ...migrated,
        version: STATE_STORAGE_VERSION,
        schemaVersion: STATE_STORAGE_VERSION,
        storageLevel: projectedLevel,
        pageLink,
      };
      if (projectedLevel === 'progress') {
        delete out.problems;
      } else {
        const inputProblems = Array.isArray(migrated.problems) ? migrated.problems : [];
        out.problems = inputProblems.map((p) => serializeProblemForSnapshot(p, projectedLevel));
      }
      if (!Array.isArray(out.seenProblemIds)) out.seenProblemIds = [];
      out.resumeFromPage = computeResumeFromStateSnapshot(out);
      return out;
    }

    function saveImportedSnapshot(snapshot, { label } = {}) {
      const migrated = migrateStateSnapshotToV2(snapshot);
      if (!migrated) return { ok: false, id: null, storageLevel: null };
      const id = createSnapshotId();
      const key = snapshotItemKey(id, STATE_STORAGE_VERSION);
      if (!key) return { ok: false, id: null, storageLevel: null };

      const desired =
        migrated.storageLevel === 'full' ||
        migrated.storageLevel === 'minimal' ||
        migrated.storageLevel === 'progress'
          ? migrated.storageLevel
          : 'minimal';
      let levels = ['progress'];
      if (desired === 'full') {
        levels = ['full', 'minimal', 'progress'];
      } else if (desired === 'minimal') {
        levels = ['minimal', 'progress'];
      }
      for (const level of levels) {
        const snap = projectSnapshotForLevel(migrated, level);
        if (!snap) continue;
        snap.savedAt = Date.now();
        if (label) snap.label = String(label);
        const writeSnapshotRes = storageSetJson(key, snap);
        if (!writeSnapshotRes.ok) {
          noteStorageFailure(writeSnapshotRes.errorType, 'import');
          continue;
        }
        const idx = pruneSnapshotIndex([
          {
            id,
            savedAt: snap.savedAt,
            storageLevel: snap.storageLevel,
            label: snap.label || '',
            storageVersion: STATE_STORAGE_VERSION,
          },
          ...loadSnapshotIndexForLink(),
        ]);
        const writeIdxRes = writeSnapshotIndexForLink(idx);
        if (!writeIdxRes.ok) {
          storageRemove(key);
          noteStorageFailure(writeIdxRes.errorType, 'index');
          return { ok: false, id: null, storageLevel: null };
        }
        return { ok: true, id, storageLevel: snap.storageLevel };
      }
      storageRemove(key);
      return { ok: false, id: null, storageLevel: null };
    }

    function serializeFilters() {
      return {
        statuses: Array.from(filterState.statuses),
        qualities: Array.from(filterState.qualities),
        includeUnknownScore: Boolean(filterState.includeUnknownScore),
        scoreMin: Number.isFinite(filterState.scoreMin) ? filterState.scoreMin : null,
        scoreMax: Number.isFinite(filterState.scoreMax) ? filterState.scoreMax : null,
        searchQuery: typeof filterState.searchQuery === 'string' ? filterState.searchQuery : '',
      };
    }

    function serializeSorted() {
      return { ...sorted };
    }

    function buildStateSnapshot(level, reason) {
      const now = Date.now();
      const snapshot = {
        version: STATE_STORAGE_VERSION,
        schemaVersion: STATE_STORAGE_VERSION,
        storageLevel: level,
        savedAt: now,
        scanMode,
        idRange: scanMode === 'id-range' ? { ...config.idRange } : null,
        pageLink,
        pagination: { ...config.pagination },
        scanStartPage: config.startPage,
        pageSize: Number.isFinite(pageSize) ? pageSize : null,
        totalProblems: Number.isFinite(totalProblems) ? totalProblems : null,
        totalPages: Number.isFinite(totalPages) ? totalPages : null,
        elapsedMs: now - startedAt,
        stats: { ...stats },
        filters: serializeFilters(),
        sorted: serializeSorted(),
        cachePolicy: {
          enabled: config.cache.enabled,
          ttlMs: config.cache.ttlMs,
          forceRefresh: config.cache.forceRefresh,
          userNamespace: parsedCacheState.userNamespace,
        },
        queueInitialized: Boolean(queueInitialized),
        pageQueue: Array.from(pageQueue),
        deferred: Array.from(deferredPageRequests.entries()),
        nextSequentialPage: Number.isFinite(nextSequentialPage) ? nextSequentialPage : null,
        inFlightPages: Array.from(activePageIndexes),
        paused: Boolean(paused),
        stopRequested: Boolean(stopRequested),
        outcomes: Object.values(outcomeLedger.entries || {}),
        verification: getVerificationMetrics(),
        end: scanEnd,
        reason: reason ? String(reason) : null,
      };

      snapshot.resumeFromPage = computeResumeFromStateSnapshot(snapshot);

      if (level === 'progress') {
        snapshot.seenProblemIds = Array.from(seenProblemIds);
        return snapshot;
      }

      snapshot.problems = allProblems.map((p) => serializeProblemForSnapshot(p, level));
      snapshot.seenProblemIds = Array.from(seenProblemIds);
      return snapshot;
    }

    function saveScanState({ mode, reason, silent } = {}) {
      const levels = resolveSaveStateLevels({
        mode,
        progressOnly: storagePolicy.progressOnly,
      });

      for (const level of levels) {
        const snap = buildStateSnapshot(level, reason);
        const key = level === 'full' ? stateKeys.full : stateKeys.minimal;
        const writeRes = storageSetJson(key, snap);
        if (!writeRes.ok) {
          noteStorageFailure(writeRes.errorType, level);
          if (!silent) {
            console.warn('Failed to save state.', {
              storageLevel: level,
              errorType: writeRes.errorType,
            });
          }
          continue;
        }
        if (level === 'full') storageRemove(stateKeys.minimal);
        return { ok: true, kind: level === 'full' ? 'full' : 'minimal', storageLevel: level };
      }

      return { ok: false, kind: null, storageLevel: null };
    }

    function restoreFromSavedState(state, kind) {
      const migrated = migrateStateSnapshotToV2(state);
      if (!migrated || migrated.pageLink !== pageLink) return false;
      restoringState = true;
      try {
        return restoreRuntimeSnapshotState({
          migrated,
          kind,
          scanMode,
          activeRequests,
          activePageIndexes,
          setInFlight(value) {
            inFlight = value;
          },
          setStopRequested(value) {
            stopRequested = value;
          },
          setPaused(value) {
            paused = value;
          },
          setScanEnd(value) {
            scanEnd = value;
          },
          config,
          setStartedAt(value) {
            startedAt = value;
          },
          getPageSize() {
            return pageSize;
          },
          setPageSize(value) {
            pageSize = value;
          },
          getTotalProblems() {
            return totalProblems;
          },
          setTotalProblems(value) {
            totalProblems = value;
          },
          getTotalPages() {
            return totalPages;
          },
          setTotalPages(value) {
            totalPages = value;
          },
          stats,
          allProblems,
          seenProblemIds,
          outcomeLedger,
          verificationState,
          refreshParsedCacheAvailability,
          filterState,
          sorted,
          pageQueue,
          deferredPageRequests,
          setQueueInitialized(value) {
            queueInitialized = value;
          },
          setNextSequentialPage(value) {
            nextSequentialPage = value;
          },
          deferPage,
          setFinished(value) {
            finished = value;
          },
          setupControls,
          pauseButton,
          stopButton,
          ensureResultsAttached,
          renderResults,
          getInFlight() {
            return inFlight;
          },
          updateProgress,
          addLog,
        });
      } finally {
        restoringState = false;
      }
    }

    function maybeAutoSave(reason) {
      if (!autosaveConfig.enabled || autosaveDisabled) return;
      const now = Date.now();
      if (
        stats.pages - lastAutosavePages < autosaveConfig.everyPages &&
        now - lastAutosaveAt < autosaveConfig.everyMs
      )
        return;
      const res = saveScanState({ mode: 'progress', reason: reason || 'autosave', silent: true });
      if (!res.ok) {
        autosaveDisabled = true;
        addLog(
          '<span style="color:#b35c00;"><b>Autosave:</b> dezactivat (nu am putut salva în localStorage).</span>'
        );
        return;
      }
      lastAutosaveAt = now;
      lastAutosavePages = stats.pages;
    }

    function schedule(fn) {
      const effectiveDelayMs = getEffectiveDelayMs();
      if (effectiveDelayMs > 0) setTimeout(fn, effectiveDelayMs);
      else fn();
    }

    function parseIdRangeScoreValue(raw) {
      const t = normalizeSpace(raw);
      if (!t || t === '-') return { value: null, raw: '-' };
      const n = Number.parseInt(t, 10);
      return Number.isFinite(n) ? { value: n, raw: t } : { value: null, raw: t };
    }

    function applyIdRangeScoreBatchPayload(payload) {
      const scores = Array.isArray(payload?.scores) ? payload.scores : [];
      let applied = 0;
      for (const item of scores) {
        const id = Number.parseInt(item?.id, 10);
        if (!Number.isFinite(id)) continue;
        const raw = item?.raw == null ? '-' : String(item.raw);
        const value = Number.isFinite(item?.value) ? item.value : null;
        idRangeScoreCache.set(id, { raw, value });
        applied++;
      }
      return applied;
    }

    function idRangeScoreBatchStartForId(id) {
      if (!Number.isFinite(id)) return null;
      const startId = Number.isFinite(config.idRange.startId) ? config.idRange.startId : 1;
      const size = Number.isFinite(config.idRange.scoreBatch?.size)
        ? config.idRange.scoreBatch.size
        : 200;
      if (id < startId || size <= 0) return null;
      return startId + Math.floor((id - startId) / size) * size;
    }

    async function fetchIdRangeScoreBatch(batchStart, retryCount = 0) {
      if (finished || stopRequested || restoringState) return;
      if (!config.idRange.scoreBatch?.enabled) return;
      if (!Number.isFinite(batchStart)) return;
      if (idRangeScoreBatchInFlight.has(batchStart) || idRangeScoreBatchFailed.has(batchStart))
        return;
      if (paused) {
        deferScoreBatch(batchStart, retryCount);
        return;
      }

      const size = Number.isFinite(config.idRange.scoreBatch.size)
        ? config.idRange.scoreBatch.size
        : 200;
      const endId = Number.isFinite(config.idRange.endId) ? config.idRange.endId : null;
      const batchRequest = buildIdRangeScoreBatchRequest({
        batchStart,
        size,
        endId,
      });
      if (!batchRequest) return;
      const { ids, batchEnd, cacheKey } = batchRequest;
      idRangeScoreBatchInFlight.add(batchStart);
      let finalized = false;
      const finalizeNoRequest = () => {
        if (finalized) return;
        finalized = true;
        idRangeScoreBatchInFlight.delete(batchStart);
      };

      let cachedPayload = null;
      try {
        cachedPayload = await readParsedCache('score-batch', cacheKey);
      } catch {
        cachedPayload = null;
      }
      if (cachedPayload && applyIdRangeScoreBatchPayload(cachedPayload) > 0) {
        recordRequestOutcome({
          targetType: 'score-batch',
          targetKey: batchStart,
          status: 'success',
          retryCount,
          durationMs: 0,
        });
        finalizeNoRequest();
        schedule(kick);
        return;
      }
      if (finished || stopRequested || restoringState) {
        finalizeNoRequest();
        return;
      }
      if (paused) {
        finalizeNoRequest();
        deferScoreBatch(batchStart, retryCount);
        return;
      }

      const requestStartedAt = Date.now();
      const controller = new AbortController();
      activeRequests.add(controller);
      let timeoutTriggered = false;
      const timeoutId = setTimeout(() => {
        timeoutTriggered = true;
        controller.abort();
      }, config.timeoutMs);
      const finalize = () => {
        if (finalized) return;
        finalized = true;
        clearTimeout(timeoutId);
        activeRequests.delete(controller);
        idRangeScoreBatchInFlight.delete(batchStart);
      };

      const url = new URL(
        '/ajx-module/json-probleme-scor.php',
        location?.origin || 'https://www.pbinfo.ro'
      );
      url.searchParams.set('ids', ids.join(','));
      const isScoreBatchCancelled = () => stopRequested || finished || restoringState;
      const scoreBatchDuration = () => Date.now() - requestStartedAt;
      const deferScoreBatchRetry = (nextRetryCount) => {
        const delay = getRetryDelayMs(retryCount);
        setTimeout(() => fetchIdRangeScoreBatch(batchStart, nextRetryCount), delay);
      };
      const recordScoreBatchOutcome = (status, nextRetryCount) => {
        recordRequestOutcome({
          targetType: 'score-batch',
          targetKey: batchStart,
          status,
          retryCount: nextRetryCount,
          durationMs: scoreBatchDuration(),
        });
      };
      const handleScoreBatchClassification = ({ classification, res }) => {
        const handlers = {
          'rate-limited': () => {
            const delay =
              parseRetryAfterMs(res.headers.get('Retry-After')) ?? getRetryDelayMs(retryCount);
            recordScoreBatchOutcome('rate-limited', retryCount + 1);
            finalize();
            if (retryCount < maxRetriesPerPage) {
              deferScoreBatch(batchStart, retryCount + 1);
              enterSystemPause('rate-limit', {
                delayMs: delay,
                message: `HTTP 429 pentru scorurile batch ${batchStart}-${batchEnd}. Reiau automat în ${getRetryDelayLabel(delay)}.`,
              });
            } else {
              idRangeScoreBatchFailed.add(batchStart);
              schedule(kick);
            }
          },
          blocked: () => {
            noteAdaptiveFailure('blocked');
            recordScoreBatchOutcome('blocked', retryCount + 1);
            if (!idRangeWarnedAboutScoreBatch) {
              idRangeWarnedAboutScoreBatch = true;
              addLog(
                '<span style="color:#b35c00;"><b>Atenție:</b> am detectat o pagină de verificare (posibil Cloudflare) la request-ul de scoruri (batch). Rezolvă challenge-ul, apoi apasă Resume now.</span>'
              );
            }
            finalize();
            if (retryCount < maxRetriesPerPage) {
              deferScoreBatch(batchStart, retryCount + 1);
              enterSystemPause('challenge', {
                message: `Challenge detectat pentru scorurile batch ${batchStart}-${batchEnd}.`,
              });
            } else {
              idRangeScoreBatchFailed.add(batchStart);
              schedule(kick);
            }
          },
          'http-error': () => {
            noteAdaptiveFailure('http');
            recordScoreBatchOutcome('http-error', retryCount + 1);
            finalize();
            if (retryCount < maxRetriesPerPage) {
              deferScoreBatchRetry(retryCount + 1);
            } else {
              idRangeScoreBatchFailed.add(batchStart);
              addLog(
                `<span style="color:#b35c00;"><b>Score batch:</b> eșuat pentru ${batchStart}-${batchEnd} (status ${res.status}); continui fără scoruri batch.</span>`
              );
              schedule(kick);
            }
          },
        };

        const applyClassification = handlers[classification];
        if (!applyClassification) return false;
        applyClassification();
        return true;
      };
      const handleScoreBatchResponse = async (res) => {
        const responseText = await res.text();
        if (isScoreBatchCancelled()) {
          finalize();
          return;
        }
        const classification = classifyScoreBatchResponse({
          status: res.status,
          responseText,
          isBlockedHtml: isLikelyPbinfoBlockedHtml,
        });
        if (handleScoreBatchClassification({ classification, res })) return;

        const parsedScores = parseScoreBatchResponsePayload({
          responseText,
          parseScoreValue: parseIdRangeScoreValue,
        });
        for (const item of parsedScores) {
          idRangeScoreCache.set(item.id, { raw: item.raw, value: item.value });
        }
        if (parsedScores.length > 0) {
          writeParsedCache('score-batch', cacheKey, { scores: parsedScores });
        }

        noteAdaptiveSuccess();
        recordScoreBatchOutcome('success', retryCount);
        finalize();
        schedule(kick);
      };
      fetch(url.toString(), {
        method: 'GET',
        signal: controller.signal,
        credentials: 'include',
      })
        .then(handleScoreBatchResponse)
        .catch((err) => {
          finalize();
          if (isScoreBatchCancelled()) return;
          const isAbort = err?.name === 'AbortError';
          if (isAbort && timeoutTriggered === true) {
            // keep handling below as timeout
          } else if (isAbort) {
            return;
          }

          noteAdaptiveFailure('network');
          recordScoreBatchOutcome(timeoutTriggered ? 'timeout' : 'unknown', retryCount + 1);
          if (retryCount < maxRetriesPerPage) {
            deferScoreBatchRetry(retryCount + 1);
            return;
          }
          idRangeScoreBatchFailed.add(batchStart);
          addLog(
            `<span style="color:#b35c00;"><b>Score batch:</b> ${timeoutTriggered ? 'timeout' : 'eroare rețea'} pentru batch ${batchStart}-${batchEnd}; continui fără scoruri batch.</span>`
          );
          schedule(kick);
        });
    }

    function getIdRangeScorePrefetchState(id) {
      if (scanMode !== 'id-range') return { cached: null, pending: false, batchStart: null };
      if (!config.idRange.scoreBatch?.enabled)
        return { cached: null, pending: false, batchStart: null };
      const cached = idRangeScoreCache.get(id) || null;
      if (cached) return { cached, pending: false, batchStart: null };
      const batchStart = idRangeScoreBatchStartForId(id);
      if (batchStart == null || idRangeScoreBatchFailed.has(batchStart))
        return { cached: null, pending: false, batchStart };
      if (!idRangeScoreBatchInFlight.has(batchStart)) fetchIdRangeScoreBatch(batchStart, 0);
      return { cached: null, pending: true, batchStart };
    }

    function processIdRangeFromScoreBatch(problemId, cached) {
      const scoreValue = Number.isFinite(cached?.value) ? cached.value : null;
      if (scoreValue == null) return false;

      stats.pages++;
      idRangeConsecutiveMissing = 0;

      const problem = createIdRangeProblemFromKnownScore({
        problemId,
        scoreValue,
        locationOrigin: location?.origin || 'https://www.pbinfo.ro',
      });
      if (!problem) return false;

      if (!seenProblemIds.has(problemId)) {
        seenProblemIds.add(problemId);
        allProblems.push({ cnt: allProblems.length + 1, ...problem });

        if (problem.status === 'solved') stats.solved++;
        else stats.tried++;
        stats.total++;
      }

      if (stats.pages > 0 && stats.pages % idRangeLogEvery === 0) {
        const forbiddenSuffix = stats.forbidden > 0 ? ` · 403 ${stats.forbidden}` : '';
        addLog(
          `ID ${problemId}: progres (${stats.pages} scanate) · găsite ${stats.total} · 404 ${stats.missing}${forbiddenSuffix}.`
        );
      }

      maybeAutoSave('id');
      updateProgress(inFlight);
      maybeLiveRender();
      return true;
    }

    function deferPage(pageIndex, retryCount) {
      if (!Number.isFinite(pageIndex)) return;
      const idx = Math.trunc(pageIndex);
      const existing = deferredPageRequests.get(idx);
      const rc = Math.max(0, Number.isFinite(retryCount) ? Math.trunc(retryCount) : 0);
      if (existing == null || rc > existing) deferredPageRequests.set(idx, rc);
    }

    function deferScoreBatch(batchStart, retryCount) {
      if (!Number.isFinite(batchStart)) return;
      const idx = Math.trunc(batchStart);
      const existing = deferredScoreBatchRequests.get(idx);
      const rc = Math.max(0, Number.isFinite(retryCount) ? Math.trunc(retryCount) : 0);
      if (existing == null || rc > existing) deferredScoreBatchRequests.set(idx, rc);
    }

    function deferVerificationProblem(problemId, retryCount) {
      if (!Number.isFinite(problemId)) return;
      const idx = Math.trunc(problemId);
      const existing = deferredVerificationRequests.get(idx);
      const rc = Math.max(0, Number.isFinite(retryCount) ? Math.trunc(retryCount) : 0);
      if (existing == null || rc > existing) deferredVerificationRequests.set(idx, rc);
    }

    function takeDeferred() {
      return takeSmallestDeferredEntry(deferredPageRequests, 'pageIndex');
    }

    function takeDeferredScoreBatch() {
      return takeSmallestDeferredEntry(deferredScoreBatchRequests, 'batchStart');
    }

    function takeDeferredVerification() {
      return takeSmallestDeferredEntry(deferredVerificationRequests, 'problemId');
    }

    function kick() {
      if (finished || paused || inFlight >= getEffectiveConcurrency()) return;

      const action = selectKickAction({
        deferredVerification: takeDeferredVerification(),
        deferredBatch: takeDeferredScoreBatch(),
        deferredPage: takeDeferred(),
        queueInitialized,
        nextSequentialPage,
      });

      if (action.kind === 'verify') {
        fetchVerificationProblem(action.problemId, action.retryCount);
        return;
      }
      if (action.kind === 'score-batch') {
        fetchIdRangeScoreBatch(action.batchStart, action.retryCount);
        return;
      }
      if (action.kind === 'page') {
        fetchPage(action.pageIndex, action.retryCount);
        return;
      }
      if (action.kind === 'queue') {
        fetchNext();
        return;
      }
      if (action.kind === 'sequential') {
        nextSequentialPage = null;
        fetchPage(action.pageIndex, 0);
      }
    }

    function maybeFinish() {
      if (finished) return;
      if (
        !isRuntimeQueueDrained({
          queueInitialized,
          pageQueueLength: pageQueue.length,
          deferredScoreBatchCount: deferredScoreBatchRequests.size,
          deferredVerificationCount: deferredVerificationRequests.size,
          inFlight,
        })
      ) {
        return;
      }

      const hasUnsolvedProblems = allProblems.some((problem) => problem.status !== 'solved');
      if (
        shouldStartVerificationPass({
          verificationState,
          hasUnsolvedProblems,
        })
      ) {
        startVerificationPass();
        return;
      }

      if (verificationState.running) {
        verificationState.running = false;
        verificationState.completed = true;
      }
      finishScan({ complete: true });
    }

    function bumpStatusCounter(status, delta) {
      if (!delta) return;
      if (status === 'solved') stats.solved += delta;
      else if (status === 'tried') stats.tried += delta;
      else if (status === 'unattempted') stats.unattempted += delta;
    }

    function startVerificationPass() {
      const candidates = allProblems.filter((p) => p.status !== 'solved');
      if (candidates.length === 0) {
        verificationState.completed = true;
        finishScan({ complete: true });
        return;
      }
      verificationState.running = true;
      verificationState.completed = false;
      verificationState.verifiedUnsolved = 0;
      verificationState.reclassifiedSolved = 0;
      verificationState.stillUnknown = 0;
      verificationState.attempted = 0;
      for (const problem of candidates) deferVerificationProblem(problem.id, 0);
      addLog(`Pornesc verificarea finală pentru ${candidates.length} probleme nerezolvate.`);
      updateTrustBar();
      for (let i = 0; i < getEffectiveConcurrency(); i++) schedule(kick);
    }

    function applyVerificationScoreInfo(
      problemId,
      scoreInfo,
      { retryCount = 0, durationMs = 0 } = {}
    ) {
      const index = allProblems.findIndex((p) => p.id === problemId);
      if (index === -1) return { cacheValue: null };
      const currentProblem = allProblems[index];
      const applied = applyVerifiedScoreToProblem(currentProblem, scoreInfo);
      const verifiedAt = Date.now();

      verificationState.attempted++;
      if (applied.verificationStatus === 'unknown') {
        verificationState.stillUnknown++;
        allProblems[index] = {
          ...currentProblem,
          ...applied.problem,
          verificationStatus: 'unknown',
          verifiedAt,
        };
        recordRequestOutcome({
          targetType: 'verify-problem',
          targetKey: problemId,
          status: 'parse-fail',
          retryCount,
          durationMs,
        });
        return { cacheValue: null };
      }

      if (applied.nextStatus !== applied.previousStatus) {
        bumpStatusCounter(applied.previousStatus, -1);
        bumpStatusCounter(applied.nextStatus, 1);
      }
      allProblems[index] = {
        ...currentProblem,
        ...applied.problem,
        verificationStatus: applied.verificationStatus,
        verifiedAt,
      };
      if (applied.verificationStatus === 'reclassified-solved') {
        verificationState.reclassifiedSolved++;
      } else {
        verificationState.verifiedUnsolved++;
      }
      recordRequestOutcome({
        targetType: 'verify-problem',
        targetKey: problemId,
        status: 'success',
        retryCount,
        durationMs,
      });

      return {
        cacheValue: Number.isFinite(applied.problem.userScore)
          ? {
              userScore: applied.problem.userScore,
              maxScore: Number.isFinite(applied.problem.maxScore) ? applied.problem.maxScore : 100,
            }
          : null,
      };
    }

    async function fetchVerificationProblem(problemId, retryCount = 0) {
      if (finished || stopRequested) return;
      if (paused) {
        deferVerificationProblem(problemId, retryCount);
        return;
      }
      const index = allProblems.findIndex((p) => p.id === problemId);
      if (index === -1) {
        schedule(kick);
        return;
      }
      const problem = allProblems[index];
      if (inFlight >= getEffectiveConcurrency()) {
        deferVerificationProblem(problemId, retryCount);
        return;
      }

      let cachedScoreInfo = null;
      try {
        cachedScoreInfo = await readParsedCache('verify-problem', String(problemId));
      } catch {
        cachedScoreInfo = null;
      }
      if (cachedScoreInfo && !finished && !stopRequested && !restoringState) {
        applyVerificationScoreInfo(problemId, cachedScoreInfo, {
          retryCount,
          durationMs: 0,
        });
        requestRenderResults();
        schedule(kick);
        return;
      }
      if (finished || stopRequested || restoringState) return;
      if (paused) {
        deferVerificationProblem(problemId, retryCount);
        return;
      }
      if (inFlight >= getEffectiveConcurrency()) {
        deferVerificationProblem(problemId, retryCount);
        return;
      }

      inFlight++;
      updateProgress(inFlight);
      const controller = new AbortController();
      activeRequests.add(controller);
      activePageIndexes.add(problemId);
      const requestStartedAt = Date.now();
      let timeoutTriggered = false;
      const timeoutId = setTimeout(() => {
        timeoutTriggered = true;
        controller.abort();
      }, config.timeoutMs);
      let finalized = false;
      const finalize = () => {
        if (finalized) return;
        finalized = true;
        clearTimeout(timeoutId);
        activeRequests.delete(controller);
        activePageIndexes.delete(problemId);
        inFlight = Math.max(0, inFlight - 1);
        updateProgress(inFlight);
      };

      const verifyUrl =
        typeof problem.link === 'string' && problem.link.trim()
          ? problem.link
          : new URL(
              `/probleme/${problemId}`,
              location?.origin || 'https://www.pbinfo.ro'
            ).toString();

      fetch(verifyUrl, {
        method: 'GET',
        signal: controller.signal,
        credentials: 'include',
      })
        .then(async (res) => {
          const responseText = await res.text();
          if (stopRequested || finished || restoringState) {
            finalize();
            return;
          }

          if (res.status === 429) {
            noteAdaptiveFailure('http');
            const delay =
              parseRetryAfterMs(res.headers.get('Retry-After')) ?? getRetryDelayMs(retryCount);
            recordRequestOutcome({
              targetType: 'verify-problem',
              targetKey: problemId,
              status: 'rate-limited',
              retryCount: retryCount + 1,
              durationMs: Date.now() - requestStartedAt,
            });
            finalize();
            if (retryCount < maxRetriesPerPage) {
              deferVerificationProblem(problemId, retryCount + 1);
              enterSystemPause('rate-limit', {
                delayMs: delay,
                message: `HTTP 429 la verificarea problemei #${problemId}. Reiau automat în ${getRetryDelayLabel(delay)}.`,
              });
              return;
            }
            verificationState.stillUnknown++;
            schedule(kick);
            return;
          }

          if (isLikelyPbinfoBlockedHtml(responseText)) {
            noteAdaptiveFailure('blocked');
            recordRequestOutcome({
              targetType: 'verify-problem',
              targetKey: problemId,
              status: 'blocked',
              retryCount: retryCount + 1,
              durationMs: Date.now() - requestStartedAt,
            });
            finalize();
            if (retryCount < maxRetriesPerPage) {
              deferVerificationProblem(problemId, retryCount + 1);
              enterSystemPause('challenge', {
                message: `Challenge detectat la verificarea problemei #${problemId}.`,
              });
              return;
            }
            verificationState.stillUnknown++;
            schedule(kick);
            return;
          }

          if (res.status !== 200) {
            noteAdaptiveFailure('http');
            recordRequestOutcome({
              targetType: 'verify-problem',
              targetKey: problemId,
              status: 'http-error',
              retryCount: retryCount + 1,
              durationMs: Date.now() - requestStartedAt,
            });
            finalize();
            if (retryCount < maxRetriesPerPage) {
              const delay = getRetryDelayMs(retryCount);
              deferVerificationProblem(problemId, retryCount + 1);
              setTimeout(() => schedule(kick), delay);
              return;
            }
            verificationState.stillUnknown++;
            schedule(kick);
            return;
          }

          const pageDoc = parseHtmlDocument(responseText);
          const scoreInfo = extractScoreInfoFromProblemPage(pageDoc);
          const result = applyVerificationScoreInfo(problemId, scoreInfo, {
            retryCount,
            durationMs: Date.now() - requestStartedAt,
          });
          if (result.cacheValue) {
            writeParsedCache('verify-problem', String(problemId), result.cacheValue);
          }

          finalize();
          requestRenderResults();
          schedule(kick);
        })
        .catch((err) => {
          finalize();
          if (stopRequested || finished || restoringState) return;
          const isAbort = err?.name === 'AbortError';
          if (isAbort && timeoutTriggered === true) {
            // keep handling below as timeout
          } else if (isAbort) {
            return;
          }

          noteAdaptiveFailure('network');
          recordRequestOutcome({
            targetType: 'verify-problem',
            targetKey: problemId,
            status: timeoutTriggered ? 'timeout' : 'unknown',
            retryCount: retryCount + 1,
            durationMs: Date.now() - requestStartedAt,
          });
          if (retryCount < maxRetriesPerPage) {
            const delay = getRetryDelayMs(retryCount);
            deferVerificationProblem(problemId, retryCount + 1);
            setTimeout(() => schedule(kick), delay);
            return;
          }
          verificationState.stillUnknown++;
          schedule(kick);
        });
    }

    function fetchNext() {
      if (finished || paused) return;
      if (inFlight >= getEffectiveConcurrency()) return;
      const next = pageQueue.shift();
      if (next == null) {
        maybeFinish();
        return;
      }
      fetchPage(next, 0);
    }

    function initQueueFromTotalPages() {
      if (queueInitialized) return;
      if (!Number.isFinite(totalPages)) return;
      const startAt = Math.max(1, Number.isFinite(config.startPage) ? config.startPage : 1);
      const cap = scanMode === 'list' && Number.isFinite(config.maxPages) ? config.maxPages : null;
      let cappedTotalPages = totalPages;
      if (cap !== null && cap !== undefined) {
        cappedTotalPages = Math.min(totalPages, cap);
      }
      if (scanMode === 'list' && cappedTotalPages < totalPages) {
        addLog(
          `<span style="color:#b35c00;"><b>Atenție:</b> totalPages=${totalPages} depășește maxPages=${cap}. Voi scana doar primele ${cappedTotalPages} pagini.</span>`
        );
        totalPages = cappedTotalPages;
      }

      for (let i = startAt + 1; i <= cappedTotalPages; i++) pageQueue.push(i);
      queueInitialized = true;
      const pagesToScan = Math.max(0, cappedTotalPages - startAt + 1);
      const extraWorkers = Math.max(0, Math.min(getEffectiveConcurrency(), pagesToScan) - 1);
      for (let i = 0; i < extraWorkers; i++) kick();
    }

    function enforcePageFetchMaxPagesLimit(pageIndex) {
      if (scanMode !== 'list') return false;
      if (!Number.isFinite(config.maxPages)) return false;
      if (pageIndex <= config.maxPages) return false;
      pageQueue.length = 0;
      deferredPageRequests.clear();
      finishScan({
        complete: false,
        reason: `Limita maxPages=${config.maxPages} a fost atinsă (pagina ${pageIndex}).`,
      });
      return true;
    }

    function resolvePrefetchedIdRangeScoreForPage(pageIndex, retryCount) {
      let knownIdRangeScore = null;
      if (scanMode !== 'id-range') return { handled: false, knownIdRangeScore };

      const prefetch = getIdRangeScorePrefetchState(pageIndex);
      if (prefetch.pending) {
        deferPage(pageIndex, retryCount);
        return { handled: true, knownIdRangeScore };
      }

      if (prefetch.cached && Number.isFinite(prefetch.cached.value)) {
        const scoreValue = prefetch.cached.value;
        if (scoreValue >= 100) {
          if (processIdRangeFromScoreBatch(pageIndex, prefetch.cached)) {
            schedule(kick);
            return { handled: true, knownIdRangeScore };
          }
        } else {
          knownIdRangeScore = scoreValue;
        }
      }
      return { handled: false, knownIdRangeScore };
    }

    function shouldDeferPageForConcurrency(pageIndex, retryCount) {
      if (inFlight < getEffectiveConcurrency()) return false;
      deferPage(pageIndex, retryCount);
      return true;
    }

    function preparePageFetchStart(pageIndex, retryCount) {
      let blocked = finished || stopRequested;
      let knownIdRangeScore = null;

      if (!blocked && paused) {
        deferPage(pageIndex, retryCount);
        blocked = true;
      }

      if (!blocked && enforcePageFetchMaxPagesLimit(pageIndex)) {
        blocked = true;
      }

      if (!blocked) {
        const prefetchResolution = resolvePrefetchedIdRangeScoreForPage(pageIndex, retryCount);
        knownIdRangeScore = prefetchResolution.knownIdRangeScore;
        if (prefetchResolution.handled) {
          blocked = true;
        } else if (shouldDeferPageForConcurrency(pageIndex, retryCount)) {
          blocked = true;
        }
      }

      return blocked ? null : { knownIdRangeScore };
    }

    function fetchPage(pageIndex, retryCount = 0) {
      const pageFetchStart = preparePageFetchStart(pageIndex, retryCount);
      if (pageFetchStart == null) return;
      const { knownIdRangeScore } = pageFetchStart;
      inFlight++;
      updateProgress(inFlight);
      const controller = new AbortController();
      activeRequests.add(controller);
      activePageIndexes.add(pageIndex);
      let timeoutTriggered = false;
      const timeoutId = setTimeout(() => {
        timeoutTriggered = true;
        controller.abort();
      }, config.timeoutMs);
      let finalized = false;
      const finalize = () => {
        if (finalized) return;
        finalized = true;
        clearTimeout(timeoutId);
        activeRequests.delete(controller);
        activePageIndexes.delete(pageIndex);
        inFlight = Math.max(0, inFlight - 1);
        updateProgress(inFlight);
      };
      const effectivePageSize = Number.isFinite(pageSize) ? pageSize : 10;
      const startOffset = scanMode === 'list' ? effectivePageSize * (pageIndex - 1) : null;
      const targetType = scanMode === 'id-range' ? 'id-page' : 'list-page';
      const requestStartedAt = Date.now();
      const url =
        scanMode === 'id-range'
          ? new URL(
              `/probleme/${pageIndex}`,
              location?.origin || 'https://www.pbinfo.ro'
            ).toString()
          : buildPageUrl(pageLink, {
              pageIndex,
              pageSize: effectivePageSize,
              mode: config.pagination.mode,
              param: config.pagination.param,
              pageBase: config.pagination.pageBase,
            });
      const isPageFetchCancelled = () => stopRequested || finished || restoringState;
      const unitLabel = buildPageUnitLabel(scanMode, pageIndex);
      const pageRequestDuration = () => Date.now() - requestStartedAt;
      const recordPageOutcome = (status, nextRetryCount) => {
        recordRequestOutcome({
          targetType,
          targetKey: pageIndex,
          status,
          retryCount: nextRetryCount,
          durationMs: pageRequestDuration(),
        });
      };
      const schedulePageRetry = (nextRetryCount) => {
        const delay = getRetryDelayMs(retryCount);
        setTimeout(() => fetchPage(pageIndex, nextRetryCount), delay);
        return delay;
      };
      const handlePageRateLimited = (res) => {
        noteAdaptiveFailure('http');
        const delay =
          parseRetryAfterMs(res.headers.get('Retry-After')) ?? getRetryDelayMs(retryCount);
        recordPageOutcome('rate-limited', retryCount + 1);
        finalize();
        if (retryCount < maxRetriesPerPage) {
          deferPage(pageIndex, retryCount + 1);
          enterSystemPause('rate-limit', {
            delayMs: delay,
            message: `${unitLabel} a răspuns cu HTTP 429. Reiau automat în ${getRetryDelayLabel(delay)}.`,
          });
          return;
        }
        finishScan({
          complete: false,
          reason: `Prea multe răspunsuri 429 la ${unitLabel}`,
        });
      };
      const handlePageBlocked = () => {
        noteAdaptiveFailure('blocked');
        recordPageOutcome('blocked', retryCount + 1);
        finalize();
        if (retryCount < maxRetriesPerPage) {
          deferPage(pageIndex, retryCount + 1);
          enterSystemPause('challenge', {
            message: `Challenge detectat la ${unitLabel}. Rezolvă verificarea din browser și apasă Resume now.`,
          });
          return;
        }
        finishScan({
          complete: false,
          reason: `Blocare detectată la ${unitLabel} (posibil Cloudflare). Încearcă delay mai mare și/sau concurență mai mică.`,
        });
      };
      const handleIdRangeMissing = () => {
        recordPageOutcome('skipped', retryCount);
        stats.pages++;
        stats.missing++;
        idRangeConsecutiveMissing++;
        maybeAutoSave('id');
        if (
          config.idRange.stopAfterMissing > 0 &&
          idRangeConsecutiveMissing >= config.idRange.stopAfterMissing
        ) {
          finalize();
          pageQueue.length = 0;
          deferredPageRequests.clear();
          finishScan({
            complete: false,
            reason: `Am întâlnit ${idRangeConsecutiveMissing} ID-uri consecutive inexistente. Oprire automată (setare PBINFO_GET_UNSOLVED_ID_MISSING_STOP).`,
          });
          return;
        }
        if (stats.pages > 0 && stats.pages % idRangeLogEvery === 0) {
          const forbiddenSuffix = stats.forbidden > 0 ? ` · 403 ${stats.forbidden}` : '';
          addLog(
            `ID ${pageIndex}: progres (${stats.pages} scanate) · găsite ${stats.total} · 404 ${stats.missing}${forbiddenSuffix}.`
          );
        }
        finalize();
        schedule(kick);
      };
      const handleIdRangeForbidden = () => {
        recordPageOutcome('skipped', retryCount);
        stats.pages++;
        stats.forbidden++;
        idRangeConsecutiveMissing = 0;
        maybeAutoSave('id');

        if (!idRangeWarnedAboutForbidden) {
          idRangeWarnedAboutForbidden = true;
          addLog(
            `<span style="color:#b35c00;"><b>Notă:</b> unele ID-uri răspund cu 401/403 (Acces interzis). Le sar și continui scanarea.</span>`
          );
        }

        const scoreValue =
          knownIdRangeScore != null && Number.isFinite(knownIdRangeScore)
            ? knownIdRangeScore
            : null;
        if (scoreValue != null && !seenProblemIds.has(pageIndex)) {
          const problem = createIdRangeProblemFromKnownScore({
            problemId: pageIndex,
            scoreValue,
            locationOrigin: location?.origin || 'https://www.pbinfo.ro',
          });
          if (!problem) {
            finalize();
            schedule(kick);
            return;
          }
          seenProblemIds.add(pageIndex);
          allProblems.push({ cnt: allProblems.length + 1, ...problem });
          if (problem.status === 'solved') stats.solved++;
          else stats.tried++;
          stats.total++;
        }

        finalize();
        schedule(kick);
      };
      const handlePageHttpError = (responseStatus) => {
        noteAdaptiveFailure('http');
        recordPageOutcome('http-error', retryCount + 1);
        if (retryCount < maxRetriesPerPage) {
          const delay = schedulePageRetry(retryCount + 1);
          addLog(
            `Eroare la ${unitLabel} (status ${responseStatus}). Reîncerc în ${getRetryDelayLabel(delay)}...`
          );
          finalize();
          return;
        }
        finalize();
        finishScan({
          complete: false,
          reason: `Eroare la ${unitLabel} (status ${responseStatus})`,
        });
      };
      const handlePageInvalidRequest = () => {
        noteAdaptiveFailure('http');
        recordPageOutcome('http-error', retryCount + 1);
        if (retryCount < maxRetriesPerPage) {
          const delay = schedulePageRetry(retryCount + 1);
          addLog(
            `Serverul a răspuns cu "Invalid request" la ${unitLabel}. Reîncerc în ${getRetryDelayLabel(delay)}...`
          );
          finalize();
          return;
        }
        finalize();
        finishScan({
          complete: false,
          reason: `Serverul a răspuns cu "Invalid request" la ${unitLabel}`,
        });
      };
      const warnIfIdRangeScoreMissing = (hasUserScoreNode) => {
        if (hasUserScoreNode || idRangeWarnedAboutScore) return;
        idRangeWarnedAboutScore = true;
        addLog(
          `<span style="color:#b35c00;"><b>Atenție:</b> nu pare să fie disponibil punctajul tău pe pagina problemei (lipsește #scor_utilizator_problema). Verifică dacă ești autentificat pe pbinfo.ro.</span>`
        );
      };
      const updateIdRangeStatusStats = (status) => {
        if (status === 'solved') stats.solved++;
        else if (status === 'tried') stats.tried++;
        else stats.unattempted++;
        stats.total++;
      };
      const maybeDebugDumpIdRangeProblem = (problemData, responseText) => {
        if (!shouldDebugDump(pageIndex)) return;
        if (problemData.scoreInfo.candidates.length > 0 && problemData.status !== 'unattempted')
          return;
        debugDumped++;
        console.log('pbinfo-get-unsolved debug problem page:', {
          id: pageIndex,
          name: problemData.meta.name,
          link: problemData.link,
          scoreInfo: {
            userScore: problemData.scoreInfo.userScore,
            maxScore: problemData.scoreInfo.maxScore,
          },
          candidates: problemData.scoreInfo.candidates,
        });
        if (debugIncludeHtml) {
          console.log('pbinfo-get-unsolved debug problem html:', responseText.slice(0, 5000));
        }
      };
      const appendIdRangeProblemIfNew = (problemData, responseText) => {
        if (seenProblemIds.has(pageIndex)) return;
        seenProblemIds.add(pageIndex);
        allProblems.push({ cnt: allProblems.length + 1, ...problemData.problem });
        updateIdRangeStatusStats(problemData.status);
        maybeDebugDumpIdRangeProblem(problemData, responseText);
      };
      const logIdRangeProgress = () => {
        if (stats.pages <= 0 || stats.pages % idRangeLogEvery !== 0) return;
        const forbiddenSuffix = stats.forbidden > 0 ? ` · 403 ${stats.forbidden}` : '';
        addLog(
          `ID ${pageIndex}: progres (${stats.pages} scanate) · găsite ${stats.total} · 404 ${stats.missing}${forbiddenSuffix}.`
        );
      };
      const finishSuccessfulPageFetch = (status) => {
        maybeLiveRender();
        maybeAutoSave(scanMode === 'id-range' ? 'id' : 'page');
        noteAdaptiveSuccess();
        recordPageOutcome(status, retryCount);
        finalize();
        schedule(kick);
      };
      const handleIdRangePageSuccess = (responseText) => {
        stats.pages++;
        idRangeConsecutiveMissing = 0;

        const pageDoc = parseHtmlDocument(responseText);
        const problemData = parseIdRangeProblemPage({
          pageDoc,
          pageIndex,
          knownIdRangeScore,
          locationOrigin: location?.origin || 'https://www.pbinfo.ro',
        });

        warnIfIdRangeScoreMissing(problemData.hasUserScoreNode);
        appendIdRangeProblemIfNew(problemData, responseText);
        logIdRangeProgress();
        finishSuccessfulPageFetch('success');
      };
      const hydrateFirstListPageMeta = (cards, responseText) => {
        if (pageIndex !== firstFetchedPageIndex) return;
        if (pageSize == null) {
          if (pageIndex === 1 && cards.length > 0) {
            pageSize = cards.length;
            addLog(`Page size detectată automat: ${pageSize}.`);
          } else {
            pageSize = effectivePageSize;
            addLog(
              `Page size implicită: ${pageSize} (pentru resume; setează PBINFO_GET_UNSOLVED_PAGE_SIZE dacă e diferit).`
            );
          }
        }
        if (totalProblems == null) {
          const parsedTotal = parseTotalProblems(responseText);
          if (Number.isFinite(parsedTotal)) totalProblems = parsedTotal;
        }
        if (Number.isFinite(totalProblems) && Number.isFinite(pageSize)) {
          totalPages = Math.ceil(totalProblems / pageSize);
        }
        updateProgress(inFlight);
        if (!queueInitialized && Number.isFinite(totalPages)) {
          addLog(
            `Total detectat: ${totalProblems} probleme · ${totalPages} pagini · pageSize=${pageSize} · startPage=${config.startPage} · concurență=${config.concurrency}.`
          );
          initQueueFromTotalPages();
        }
      };
      const handleEmptyListCards = (responseText) => {
        const parsedTotal = totalProblems ?? parseTotalProblems(responseText);
        if (Number.isFinite(parsedTotal) && startOffset >= parsedTotal) {
          recordPageOutcome('skipped', retryCount);
          finalize();
          if (queueInitialized) {
            pageQueue.length = 0;
            maybeFinish();
            return;
          }
          finishScan({ complete: true });
          return;
        }
        if (retryCount < maxRetriesPerPage) {
          const delay = schedulePageRetry(retryCount + 1);
          const hint = Number.isFinite(parsedTotal)
            ? `0 probleme, dar total=${parsedTotal}`
            : '0 probleme';
          recordPageOutcome('parse-fail', retryCount + 1);
          addLog(
            `Pagina ${pageIndex} pare goală (${hint}). Reîncerc în ${getRetryDelayLabel(delay)}...`
          );
          finalize();
          return;
        }
        const hint = Number.isFinite(parsedTotal)
          ? `Pagina ${pageIndex} goală deși totalul este ${parsedTotal}`
          : `Pagina ${pageIndex} goală`;
        recordPageOutcome('parse-fail', retryCount + 1);
        finalize();
        finishScan({ complete: false, reason: hint });
      };
      const accumulateListCardSummary = (summary, card) => {
        const parsedCard = parseListProblemCard(card);
        if (parsedCard.kind === 'skip') return;
        if (parsedCard.kind === 'invalid-id') {
          summary.idFailCount++;
          if (debugEnabled && debugDumped < debugDumpLimit && !debugIds) {
            debugDumpCard(card, { id: null, name: null, link: null, scoreInfo: null });
          }
          return;
        }

        const { id, scoreInfo, status, problem, parseFailed } = parsedCard;
        if (seenProblemIds.has(id)) return;
        seenProblemIds.add(id);
        summary.totalCount++;
        if (parseFailed) summary.parseFailCount++;

        incrementListPageStatusCounters(summary, status, stats);
        stats.total++;
        allProblems.push({ cnt: allProblems.length + 1, ...problem });

        if (
          shouldDebugDump(id) &&
          (scoreInfo.candidates.length === 0 || status === 'unattempted')
        ) {
          debugDumpCard(card, { id, name: problem.name, link: problem.link, scoreInfo });
        }
      };
      const collectListPageSummary = (cards) => {
        const summary = createListPageSummary();
        for (let card of cards) {
          accumulateListCardSummary(summary, card);
        }
        return summary;
      };
      const logListPageSummary = (summary) => {
        const scoreUnavailable = summary.pageUnattempted === summary.totalCount;
        const scoreWarning = scoreUnavailable ? ' (punctaj indisponibil pentru toate)' : '';
        const parseFailSuffix =
          summary.parseFailCount > 0 ? ` · parseFail=${summary.parseFailCount}` : '';
        const idFailSuffix = summary.idFailCount > 0 ? ` · idFail=${summary.idFailCount}` : '';
        addLog(
          `Pagina ${pageIndex}: rezolvate ${summary.pageSolved}, încercate ${summary.pageTried}, neîncercate ${summary.pageUnattempted} (total ${summary.totalCount})${scoreWarning}${parseFailSuffix}${idFailSuffix}.`
        );
        if (pageIndex === firstFetchedPageIndex && summary.totalCount > 0 && scoreUnavailable) {
          addLog(
            `<span style="color:#b35c00;"><b>Atenție:</b> nu pare să fie disponibil punctajul tău pe această listă. Verifică dacă ești autentificat pe pbinfo.ro.</span>`
          );
        }
      };
      const handleListPageSuccess = (responseText) => {
        const pageDoc = parseHtmlDocument(responseText);
        const cards = pageDoc.querySelectorAll('div.card.mb-3');
        hydrateFirstListPageMeta(cards, responseText);
        if (cards.length === 0) {
          handleEmptyListCards(responseText);
          return;
        }

        stats.pages++;
        const summary = collectListPageSummary(cards);
        logListPageSummary(summary);
        const outcomeStatus =
          summary.parseFailCount > 0 && summary.totalCount === 0 ? 'parse-fail' : 'success';
        maybeLiveRender();
        maybeAutoSave('page');
        noteAdaptiveSuccess();
        recordPageOutcome(outcomeStatus, retryCount);
        finalize();
        if (queueInitialized) {
          schedule(kick);
          return;
        }
        nextSequentialPage = pageIndex + 1;
        schedule(kick);
      };
      const handlePageFetchResponse = async (res) => {
        const responseText = await res.text();
        const responseStatus = res.status;
        if (isPageFetchCancelled()) {
          finalize();
          return;
        }
        const responseKind = classifyPageFetchResponse({
          scanMode,
          status: responseStatus,
          responseText,
          isBlockedHtml: isLikelyPbinfoBlockedHtml,
          isNotFoundHtml: isLikelyPbinfoNotFoundHtml,
        });
        const responseKindHandlers = {
          'rate-limited': () => handlePageRateLimited(res),
          blocked: handlePageBlocked,
          'id-range-missing': handleIdRangeMissing,
          'id-range-forbidden': handleIdRangeForbidden,
          'http-error': () => handlePageHttpError(responseStatus),
          'invalid-request': handlePageInvalidRequest,
        };
        const classifiedResponseHandler = responseKindHandlers[responseKind];
        if (classifiedResponseHandler) {
          classifiedResponseHandler();
          return;
        }
        if (scanMode === 'id-range') {
          handleIdRangePageSuccess(responseText);
          return;
        }
        handleListPageSuccess(responseText);
      };
      fetch(url, {
        method: 'GET',
        signal: controller.signal,
        credentials: 'include',
      })
        .then(handlePageFetchResponse)
        .catch((err) => {
          finalize();
          if (isPageFetchCancelled()) return;
          const isAbort = err?.name === 'AbortError';
          if (isAbort && timeoutTriggered === true) {
            // keep handling below as timeout
          } else if (isAbort) {
            return;
          }

          noteAdaptiveFailure('network');
          recordPageOutcome(timeoutTriggered ? 'timeout' : 'unknown', retryCount + 1);
          if (retryCount < maxRetriesPerPage) {
            const delay = schedulePageRetry(retryCount + 1);
            if (timeoutTriggered) {
              addLog(`Timeout la ${unitLabel}. Reîncerc în ${getRetryDelayLabel(delay)}...`);
            } else {
              addLog(
                `Eroare de rețea la ${unitLabel}. Reîncerc în ${getRetryDelayLabel(delay)}...`
              );
            }
            return;
          }

          finishScan({
            complete: false,
            reason: `${timeoutTriggered ? 'Timeout' : 'Eroare de rețea'} la ${unitLabel}`,
          });
        });
    }

    function resumePendingRestoreIfNeeded() {
      if (!pendingRestore) return false;
      restoreFromSavedState(pendingRestore, restoreMode);
      pendingRestore = null;
      restoreMode = null;
      if (!finished && !stopRequested && !paused) {
        for (let i = 0; i < getEffectiveConcurrency(); i++) schedule(kick);
      }
      return true;
    }

    function initializeFreshScanLoop() {
      if (scanMode === 'id-range') {
        const startId = Math.max(1, Number.isFinite(config.startPage) ? config.startPage : 1);
        const endId = Number.isFinite(config.idRange.endId) ? config.idRange.endId : null;
        if (endId != null && endId >= startId) {
          const totalIds = endId - startId + 1;
          addLog(`Voi scana ID-uri: ${startId}-${endId} (${totalIds} request-uri).`);
        }
        if (getEffectiveDelayMs() === 0 && getEffectiveConcurrency() > 1) {
          addLog(
            '<span style="color:#b35c00;"><b>Recomandare:</b> pentru scanare pe ID-uri, setează PBINFO_GET_UNSOLVED_DELAY_MS (ex: 150) și concurență mică (1-2), ca să eviți blocarea.</span>'
          );
        }
        initQueueFromTotalPages();
      }
      fetchPage(config.startPage, 0);
    }

    function startRuntimeScanLoop() {
      if (resumePendingRestoreIfNeeded()) return;
      initializeFreshScanLoop();
    }

    startRuntimeScanLoop();
  }

  globalThis.pbinfoGetUnsolvedStart = runPbinfoGetUnsolved;
  if (globalThis.PBINFO_GET_UNSOLVED_NO_AUTORUN !== true) {
    autorunPbinfoGetUnsolved();
  }
}
