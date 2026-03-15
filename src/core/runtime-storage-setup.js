const { normalizeSpace } = require('./text-utils');
const { normalizeListUrl } = require('./network');
const {
  getSpeedPresetConfig,
  styleWizardControl,
  loadThemePreference,
  applyThemePreference,
  saveSetupPreferences,
  parseIdRangeInput,
} = require('./runtime-setup');

function formatDateTime(ts) {
  const date = new Date(Number(ts));

  if (!Number.isFinite(date.getTime())) {
    return '-';
  }

  return date.toLocaleString();
}

function buildSetupWizardDefaults({ setupDefaults, modeFromWindow, defaultLink, config }) {
  const defaults =
    setupDefaults !== null &&
    !Array.isArray(setupDefaults) &&
    Object(setupDefaults) === setupDefaults
      ? setupDefaults
      : {};

  return {
    scanMode: defaults.scanMode || modeFromWindow || 'list',
    pageLink: defaults.pageLink || defaultLink,
    idRange: defaults.idRange || `${config.idRange.startId}-${config.idRange.endId}`,
    startPage: defaults.startPage || config.startPage,
    speedPreset: defaults.speedPreset || 'balanced',
    verifyUnsolved: defaults.verifyUnsolved === true,
    forceRefresh: defaults.forceRefresh === true || config.cache.forceRefresh,
    resumeSavedState: defaults.resumeSavedState !== false,
    sourceMode: defaults.sourceMode || 'current',
  };
}

function parseStartPageInput(value, fallback) {
  const rawValue = normalizeSpace(value);
  const candidate = rawValue === '' ? fallback : rawValue;
  const parsedValue = Number.parseInt(candidate, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return null;
  }

  return parsedValue;
}

function parseNormalizedIdRangeInput(value, fallback) {
  const parsedRange = parseIdRangeInput(value, fallback);

  if (parsedRange == null) {
    return null;
  }

  return {
    startId: Math.min(parsedRange.startId, parsedRange.endId),
    endId: Math.max(parsedRange.startId, parsedRange.endId),
  };
}

function buildIdRangePageLink(locationRef, idRange) {
  return `id-range:${locationRef?.origin || 'https://www.pbinfo.ro'}:${idRange.startId}-${idRange.endId}`;
}

function buildSetupSummaryText({
  mode,
  sourceMode,
  rangeInputValue,
  startPage,
  config,
  speedPreset,
  cacheEnabled,
  forceRefresh,
}) {
  const speed = getSpeedPresetConfig(speedPreset);
  const startLabel = startPage || config.startPage;
  const rangeLabel =
    normalizeSpace(rangeInputValue) || `${config.idRange.startId}-${config.idRange.endId}`;
  const scanTargetLabel = sourceMode === 'custom' ? 'link-ul furnizat' : 'pagina curentă';
  let cacheLabel = 'activ';
  let prefix = `Va scana ${scanTargetLabel}`;

  if (!cacheEnabled) {
    cacheLabel = 'dezactivat';
  } else if (forceRefresh) {
    cacheLabel = 'bypass';
  }

  if (mode === 'id-range') {
    prefix = `Va scana intervalul ${rangeLabel}`;
  }

  return (
    `${prefix} de la ${startLabel}. Preset ${speed.preset}: delay ${speed.delayMs}ms, ` +
    `concurență ${speed.concurrency}. Cache ${cacheLabel}.`
  );
}

function resolveIdRangeWizardTarget({ rangeInputValue, config, startPage, locationRef }) {
  const idRange = parseNormalizedIdRangeInput(
    rangeInputValue,
    `${config.idRange.startId}-${config.idRange.endId}`
  );

  if (idRange == null) {
    return { ok: false, errorText: 'Interval ID invalid.' };
  }

  if (startPage > idRange.endId) {
    return { ok: false, errorText: 'Start-ul depășește capătul intervalului.' };
  }

  return {
    ok: true,
    pageLink: buildIdRangePageLink(locationRef, idRange),
    idRange,
  };
}

function resolveListWizardTarget({ sourceMode, urlInputValue, defaultLink, config }) {
  const pageLink = normalizeListUrl(
    sourceMode === 'custom' ? urlInputValue : defaultLink,
    defaultLink,
    config.pagination.param
  );

  if (!pageLink) {
    return { ok: false, errorText: 'Link invalid.' };
  }

  return {
    ok: true,
    pageLink,
    idRange: null,
  };
}

function resolveWizardTarget(options) {
  if (options.mode === 'id-range') {
    return resolveIdRangeWizardTarget(options);
  }

  return resolveListWizardTarget(options);
}

function parseWizardNumericInput(value, fallback, minValue) {
  const parsed = Number.parseInt(value || String(fallback), 10);
  const normalized = parsed || fallback;
  return Math.max(minValue, normalized);
}

function buildRememberedWizardPreferences({ result, mode, pageLink, defaultLink, idRange }) {
  return {
    scanMode: result.scanMode,
    pageLink: mode === 'list' ? pageLink : defaultLink,
    idRange: idRange ? `${idRange.startId}-${idRange.endId}` : '',
    startPage: result.startPage,
    speedPreset: result.speedPreset,
    verifyUnsolved: result.verifyUnsolved,
    forceRefresh: result.forceRefresh,
    resumeSavedState: result.resumeSavedState,
    sourceMode: result.sourceMode,
  };
}

function resolveSetupWizardResult({
  mode,
  sourceMode,
  defaultLink,
  urlInputValue,
  rangeInputValue,
  startInputValue,
  speedPresetValue,
  concurrencyInputValue,
  delayInputValue,
  verifyUnsolved,
  forceRefresh,
  resumeSavedState,
  config,
  locationRef = globalThis.location,
}) {
  const startPage = parseStartPageInput(startInputValue, config.startPage || 1);

  if (startPage == null) {
    return { ok: false, errorText: 'Start invalid.' };
  }

  const target = resolveWizardTarget({
    mode,
    sourceMode,
    urlInputValue,
    rangeInputValue,
    defaultLink,
    config,
    startPage,
    locationRef,
  });

  if (!target.ok) {
    return target;
  }

  const speed = getSpeedPresetConfig(speedPresetValue);
  const result = {
    scanMode: mode,
    pageLink: target.pageLink,
    startPage,
    idRange: target.idRange,
    verifyUnsolved: verifyUnsolved === true,
    forceRefresh: forceRefresh === true,
    resumeSavedState: resumeSavedState === true,
    speedPreset: speed.preset,
    concurrency: parseWizardNumericInput(concurrencyInputValue, speed.concurrency, 1),
    delayMs: parseWizardNumericInput(delayInputValue, speed.delayMs, 0),
    sourceMode: sourceMode === 'custom' ? 'custom' : 'current',
  };

  return {
    ok: true,
    result,
    rememberedPreferences: buildRememberedWizardPreferences({
      result,
      mode,
      pageLink: target.pageLink,
      defaultLink,
      idRange: target.idRange,
    }),
  };
}

function applyInitialThemePreference({ localStorageApi, appRoot, documentElement }) {
  const storedTheme = loadThemePreference(localStorageApi);

  return applyThemePreference(storedTheme, appRoot, {
    localStorageApi,
    fallbackTarget: documentElement,
  });
}

function createWizardModalScaffold(documentRef) {
  const modalRoot = documentRef.createElement('div');
  modalRoot.style.position = 'fixed';
  modalRoot.style.inset = '0';
  modalRoot.style.zIndex = '2147483647';
  modalRoot.style.background = 'rgba(15, 23, 42, 0.78)';
  modalRoot.style.display = 'flex';
  modalRoot.style.alignItems = 'center';
  modalRoot.style.justifyContent = 'center';
  modalRoot.style.padding = '24px';

  const panel = documentRef.createElement('div');
  panel.style.width = 'min(760px, 100%)';
  panel.style.maxHeight = 'calc(100vh - 48px)';
  panel.style.overflow = 'auto';
  panel.style.background = '#ffffff';
  panel.style.color = '#0f172a';
  panel.style.borderRadius = '18px';
  panel.style.padding = '22px';
  panel.style.boxShadow = '0 22px 80px rgba(15, 23, 42, 0.35)';
  panel.style.fontFamily = 'system-ui, sans-serif';
  modalRoot.appendChild(panel);

  const heading = documentRef.createElement('h3');
  heading.textContent = 'Configurează scanarea';
  heading.style.margin = '0 0 6px';
  panel.appendChild(heading);

  const intro = documentRef.createElement('p');
  intro.textContent =
    'Alege modul, sursa și viteza. Setările pot fi memorate pentru următoarea rulare.';
  intro.style.margin = '0 0 18px';
  panel.appendChild(intro);

  const form = documentRef.createElement('div');
  form.style.display = 'grid';
  form.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
  form.style.gap = '14px';
  panel.appendChild(form);

  return { modalRoot, panel, form };
}

function addWizardField(documentRef, form, labelText, control) {
  const wrap = documentRef.createElement('label');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '6px';
  wrap.style.fontSize = '14px';
  const label = documentRef.createElement('span');
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(control);
  form.appendChild(wrap);
  return wrap;
}

function createWizardSelect({ documentRef, role, options, value, setSelectOptions }) {
  const control = styleWizardControl(documentRef.createElement('select'));
  control.dataset.role = role;
  setSelectOptions(control, options);
  control.value = value;
  return control;
}

function createWizardInput({ documentRef, role, type, value, min }) {
  const control = styleWizardControl(documentRef.createElement('input'));
  control.dataset.role = role;
  control.type = type;
  control.value = value;

  if (min != null) {
    control.min = min;
  }

  return control;
}

function createPrimaryWizardControls({ documentRef, form, currentDefaults, setSelectOptions }) {
  const modeSelect = createWizardSelect({
    documentRef,
    role: 'setup-mode',
    options: [
      { value: 'list', label: 'Listă' },
      { value: 'id-range', label: 'Interval ID' },
    ],
    value: currentDefaults.scanMode === 'id-range' ? 'id-range' : 'list',
    setSelectOptions,
  });
  addWizardField(documentRef, form, 'Mod', modeSelect);

  const sourceSelect = createWizardSelect({
    documentRef,
    role: 'setup-source',
    options: [
      { value: 'current', label: 'Pagina curentă' },
      { value: 'custom', label: 'Link lipit' },
    ],
    value: currentDefaults.sourceMode === 'custom' ? 'custom' : 'current',
    setSelectOptions,
  });
  const sourceWrap = addWizardField(documentRef, form, 'Sursă listă', sourceSelect);

  const urlInput = createWizardInput({
    documentRef,
    role: 'setup-url',
    type: 'url',
    value: currentDefaults.pageLink,
  });
  addWizardField(documentRef, form, 'Link listă', urlInput);

  const rangeInput = createWizardInput({
    documentRef,
    role: 'setup-range',
    type: 'text',
    value: currentDefaults.idRange,
  });
  addWizardField(documentRef, form, 'Interval ID', rangeInput);

  const startInput = createWizardInput({
    documentRef,
    role: 'setup-start',
    type: 'number',
    value: String(currentDefaults.startPage),
    min: '1',
  });
  addWizardField(documentRef, form, 'Start', startInput);

  const speedSelect = createWizardSelect({
    documentRef,
    role: 'setup-speed',
    options: [
      { value: 'safe', label: 'Safe' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'fast', label: 'Fast' },
    ],
    value: currentDefaults.speedPreset,
    setSelectOptions,
  });
  addWizardField(documentRef, form, 'Viteză', speedSelect);

  return { modeSelect, sourceSelect, sourceWrap, urlInput, rangeInput, startInput, speedSelect };
}

function createWizardCheckboxRow({ documentRef, form, role, text, checked }) {
  const wrap = documentRef.createElement('label');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '8px';
  wrap.style.gridColumn = '1 / -1';

  const check = documentRef.createElement('input');
  check.dataset.role = role;
  check.type = 'checkbox';
  check.checked = checked;

  wrap.appendChild(check);
  wrap.appendChild(documentRef.createTextNode(text));
  form.appendChild(wrap);
  return check;
}

function createToggleWizardControls({ documentRef, form, currentDefaults, config }) {
  const verifyCheck = createWizardCheckboxRow({
    documentRef,
    form,
    role: 'setup-verify',
    text: 'Verifică problemele nerezolvate la final',
    checked: currentDefaults.verifyUnsolved === true,
  });
  const forceRefreshCheck = createWizardCheckboxRow({
    documentRef,
    form,
    role: 'setup-force-refresh',
    text: 'Force refresh (ignoră cache-ul existent pentru această scanare)',
    checked: currentDefaults.forceRefresh === true,
  });
  const resumeCheck = createWizardCheckboxRow({
    documentRef,
    form,
    role: 'setup-resume',
    text: 'Încarcă automat starea salvată dacă există',
    checked: currentDefaults.resumeSavedState !== false,
  });
  const rememberCheck = createWizardCheckboxRow({
    documentRef,
    form,
    role: 'setup-remember',
    text: 'Memorează aceste setări',
    checked: true,
  });

  return {
    verifyCheck,
    forceRefreshCheck,
    resumeCheck,
    rememberCheck,
    cacheEnabled: config.cache.enabled,
  };
}

function createAdvancedWizardControls({ documentRef, form, config }) {
  const advancedWrap = documentRef.createElement('details');
  advancedWrap.style.gridColumn = '1 / -1';
  const advancedSummary = documentRef.createElement('summary');
  advancedSummary.textContent = 'Advanced';
  advancedWrap.appendChild(advancedSummary);
  const advancedGrid = documentRef.createElement('div');
  advancedGrid.style.display = 'grid';
  advancedGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))';
  advancedGrid.style.gap = '12px';
  advancedGrid.style.marginTop = '10px';
  advancedWrap.appendChild(advancedGrid);
  form.appendChild(advancedWrap);

  const concurrencyInput = createWizardInput({
    documentRef,
    role: 'setup-concurrency',
    type: 'number',
    value: String(config.concurrency),
    min: '1',
  });
  const delayInput = createWizardInput({
    documentRef,
    role: 'setup-delay',
    type: 'number',
    value: String(config.delayMs),
    min: '0',
  });
  addWizardField(documentRef, advancedGrid, 'Concurență', concurrencyInput);
  addWizardField(documentRef, advancedGrid, 'Delay (ms)', delayInput);

  return { concurrencyInput, delayInput };
}

function createWizardStatusElements({ documentRef, panel }) {
  const errorBox = documentRef.createElement('div');
  errorBox.dataset.role = 'setup-error';
  errorBox.style.color = '#b91c1c';
  errorBox.style.fontSize = '13px';
  errorBox.style.marginTop = '12px';
  panel.appendChild(errorBox);

  const summary = documentRef.createElement('div');
  summary.dataset.role = 'setup-summary';
  summary.style.marginTop = '14px';
  summary.style.padding = '12px';
  summary.style.border = '1px solid #e2e8f0';
  summary.style.borderRadius = '12px';
  summary.style.background = '#f8fafc';
  panel.appendChild(summary);

  return { errorBox, summary };
}

function createWizardActions({ documentRef, panel }) {
  const actions = documentRef.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'space-between';
  actions.style.gap = '12px';
  actions.style.marginTop = '16px';
  panel.appendChild(actions);

  const cancelBtn = styleWizardControl(documentRef.createElement('button'));
  cancelBtn.dataset.role = 'setup-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.type = 'button';
  cancelBtn.style.width = 'auto';
  cancelBtn.style.background = '#ffffff';

  const startBtn = styleWizardControl(documentRef.createElement('button'));
  startBtn.dataset.role = 'setup-start-button';
  startBtn.textContent = 'Start scan';
  startBtn.type = 'button';
  startBtn.style.width = 'auto';
  startBtn.style.background = '#0f172a';
  startBtn.style.color = '#ffffff';
  startBtn.style.borderColor = '#0f172a';

  actions.appendChild(cancelBtn);
  actions.appendChild(startBtn);

  return { cancelBtn, startBtn };
}

function buildSetupWizardUi({ documentRef, currentDefaults, config, setSelectOptions }) {
  const { modalRoot, panel, form } = createWizardModalScaffold(documentRef);
  const primary = createPrimaryWizardControls({
    documentRef,
    form,
    currentDefaults,
    setSelectOptions,
  });
  const toggles = createToggleWizardControls({ documentRef, form, currentDefaults, config });
  const advanced = createAdvancedWizardControls({ documentRef, form, config });
  const status = createWizardStatusElements({ documentRef, panel });
  const actions = createWizardActions({ documentRef, panel });

  return { modalRoot, ...primary, ...toggles, ...advanced, ...status, ...actions };
}

function updateSetupWizardVisibility(wizardUi, isList) {
  wizardUi.sourceWrap.style.display = isList ? '' : 'none';
  wizardUi.urlInput.parentElement.style.display =
    isList && wizardUi.sourceSelect.value === 'custom' ? '' : 'none';
  wizardUi.rangeInput.parentElement.style.display = isList ? 'none' : '';
}

function updateSetupWizardView(wizardUi, config) {
  const mode = wizardUi.modeSelect.value === 'id-range' ? 'id-range' : 'list';
  const isList = mode === 'list';
  updateSetupWizardVisibility(wizardUi, isList);
  wizardUi.summary.textContent = buildSetupSummaryText({
    mode,
    sourceMode: wizardUi.sourceSelect.value === 'custom' ? 'custom' : 'current',
    rangeInputValue: wizardUi.rangeInput.value,
    startPage: wizardUi.startInput.value || config.startPage,
    config,
    speedPreset: wizardUi.speedSelect.value,
    cacheEnabled: config.cache.enabled,
    forceRefresh: wizardUi.forceRefreshCheck.checked,
  });
}

function updateSetupWizardViewFromUi(wizardUi, config) {
  updateSetupWizardView(wizardUi, config);
}

function bindSetupWizardViewListeners(wizardUi, updateWizardView) {
  wizardUi.modeSelect.addEventListener('change', updateWizardView);
  wizardUi.sourceSelect.addEventListener('change', updateWizardView);
  wizardUi.rangeInput.addEventListener('input', updateWizardView);
  wizardUi.startInput.addEventListener('input', updateWizardView);
  wizardUi.speedSelect.addEventListener('change', updateWizardView);
  wizardUi.forceRefreshCheck.addEventListener('change', updateWizardView);
}

function resolveWizardStartSubmission({ wizardUi, defaultLink, config, locationRef }) {
  return resolveSetupWizardResult({
    mode: wizardUi.modeSelect.value === 'id-range' ? 'id-range' : 'list',
    sourceMode: wizardUi.sourceSelect.value === 'custom' ? 'custom' : 'current',
    defaultLink,
    urlInputValue: wizardUi.urlInput.value,
    rangeInputValue: wizardUi.rangeInput.value,
    startInputValue: wizardUi.startInput.value,
    speedPresetValue: wizardUi.speedSelect.value,
    concurrencyInputValue: wizardUi.concurrencyInput.value,
    delayInputValue: wizardUi.delayInput.value,
    verifyUnsolved: wizardUi.verifyCheck.checked,
    forceRefresh: wizardUi.forceRefreshCheck.checked,
    resumeSavedState: wizardUi.resumeCheck.checked,
    config,
    locationRef,
  });
}

function showSetupWizard({
  defaultLink,
  config,
  defaults,
  overlayEnabled,
  localStorageApi = globalThis.localStorage,
  documentRef = globalThis.document,
  locationRef = globalThis.location,
  setSelectOptions,
}) {
  if (!overlayEnabled) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const currentDefaults = buildSetupWizardDefaults({
      setupDefaults: defaults,
      modeFromWindow: defaults?.scanMode || null,
      defaultLink,
      config,
    });
    const wizardUi = buildSetupWizardUi({
      documentRef,
      currentDefaults,
      config,
      setSelectOptions,
    });
    documentRef.body.appendChild(wizardUi.modalRoot);

    function close(result) {
      wizardUi.modalRoot.remove();
      resolve(result);
    }

    const updateWizardView = () => updateSetupWizardViewFromUi(wizardUi, config);
    bindSetupWizardViewListeners(wizardUi, updateWizardView);
    updateWizardView();

    wizardUi.cancelBtn.addEventListener('click', function () {
      close(null);
    });
    wizardUi.startBtn.addEventListener('click', function () {
      wizardUi.errorBox.textContent = '';
      const resolved = resolveWizardStartSubmission({ wizardUi, defaultLink, config, locationRef });

      if (!resolved.ok) {
        wizardUi.errorBox.textContent = resolved.errorText;
        return;
      }

      if (wizardUi.rememberCheck.checked) {
        saveSetupPreferences(resolved.rememberedPreferences, localStorageApi);
      }

      close(resolved.result);
    });
  });
}

module.exports = {
  formatDateTime,
  buildSetupWizardDefaults,
  parseStartPageInput,
  parseNormalizedIdRangeInput,
  buildIdRangePageLink,
  buildSetupSummaryText,
  resolveSetupWizardResult,
  applyInitialThemePreference,
  showSetupWizard,
};
