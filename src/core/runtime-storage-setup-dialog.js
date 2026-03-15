const { saveSetupPreferences } = require('./runtime-setup');
const { buildSetupWizardUi, updateSetupWizardVisibility } = require('./runtime-storage-setup-ui');
const {
  formatDateTime,
  buildSetupWizardDefaults,
  parseStartPageInput,
  parseNormalizedIdRangeInput,
  buildIdRangePageLink,
  buildSetupSummaryText,
  resolveSetupWizardResult,
  applyInitialThemePreference,
} = require('./runtime-storage-setup-helpers');

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
