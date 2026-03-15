(function () {
  const { normalizeSettings, isCallable } = require('../shared');
  const SETTINGS_ATTR = 'data-pbinfo-get-unsolved-settings';

  function readSettingsAttribute() {
    const attribute = document.documentElement.getAttribute(SETTINGS_ATTR);

    if (!attribute) {
      return {};
    }

    try {
      return JSON.parse(attribute);
    } catch {
      return {};
    }
  }

  function applySettings() {
    const settings = normalizeSettings(readSettingsAttribute());

    globalThis.PBINFO_GET_UNSOLVED_NO_AUTORUN = true;
    globalThis.PBINFO_GET_UNSOLVED_OVERLAY = true;
    globalThis.PBINFO_GET_UNSOLVED_VERIFY_UNSOLVED = settings.verifyUnsolved;
    globalThis.PBINFO_GET_UNSOLVED_CACHE_ENABLED = settings.cacheEnabled;
    globalThis.PBINFO_GET_UNSOLVED_FORCE_REFRESH = settings.forceRefresh;
    globalThis.PBINFO_GET_UNSOLVED_CACHE_TTL_MS = settings.cacheTtlMs;
    globalThis.PBINFO_GET_UNSOLVED_NAV_SCOPE = settings.navScope;
  }

  function launchScanner() {
    applySettings();

    if (isCallable(globalThis.pbinfoGetUnsolvedStart)) {
      globalThis.pbinfoGetUnsolvedStart();
    }
  }

  if (globalThis.__PBINFO_GET_UNSOLVED_EXTENSION_BRIDGE_READY__) {
    return;
  }

  globalThis.__PBINFO_GET_UNSOLVED_EXTENSION_BRIDGE_READY__ = true;
  applySettings();
  globalThis.addEventListener('pbinfo-get-unsolved-extension-refresh-config', applySettings, false);
  globalThis.addEventListener('pbinfo-get-unsolved-extension-launch', launchScanner, false);
})();
