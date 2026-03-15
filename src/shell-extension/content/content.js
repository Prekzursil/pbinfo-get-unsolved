(function () {
  const {
    DEFAULTS,
    getApi,
    storageGet,
    normalizeSettings,
    openTab,
    isCallable,
  } = require('../shared');
  const SETTINGS_ATTR = 'data-pbinfo-get-unsolved-settings';
  const CORE_SCRIPT_ID = 'pbinfo-get-unsolved-extension-core';
  const BRIDGE_SCRIPT_ID = 'pbinfo-get-unsolved-extension-bridge';
  const BUTTON_ID = 'pbinfo-get-unsolved-extension-start';
  let runtimeLoading = false;
  let runtimeCallbacks = [];

  function loadSettings(callback) {
    storageGet(DEFAULTS, function (raw) {
      callback(normalizeSettings(raw));
    });
  }

  function getAppendTarget() {
    return document.head || document.documentElement || document.body || null;
  }

  function injectScriptFile(filename, id, callback) {
    const target = getAppendTarget();
    const scriptUrl = getApi()?.runtime?.getURL?.(filename);
    const existing = document.getElementById(id);

    if (!target) {
      callback(new Error('No DOM target available for script injection.'));
      return;
    }

    if (!scriptUrl) {
      callback(new Error('Extension runtime API unavailable.'));
      return;
    }

    if (existing) {
      const existingTag = existing.tagName?.toLowerCase();
      const existingSrc = existing.getAttribute('src') || existing.src || '';
      const hasExpectedTag = existingTag === 'script';
      const hasExpectedSource = existingSrc === scriptUrl;

      if (hasExpectedTag && hasExpectedSource) {
        callback(null, existing);
        return;
      }

      existing.remove();
    }

    const script = document.createElement('script');
    script.id = id;
    script.src = scriptUrl;
    script.async = false;
    script.onload = function () {
      callback(null, script);
    };
    script.onerror = function () {
      callback(new Error('Failed to load ' + filename));
    };
    target.appendChild(script);
  }

  function dispatchPageEvent(name) {
    globalThis.dispatchEvent(new CustomEvent(name));
  }

  function updatePageSettings(settings) {
    document.documentElement.setAttribute(SETTINGS_ATTR, JSON.stringify(settings));
    dispatchPageEvent('pbinfo-get-unsolved-extension-refresh-config');
  }

  function flushRuntimeCallbacks(error, settings) {
    const pendingCallbacks = runtimeCallbacks.slice(0);

    runtimeCallbacks = [];
    runtimeLoading = false;

    for (const callback of pendingCallbacks) {
      callback(error, settings);
    }
  }

  function onCoreScriptLoaded(settings, coreError) {
    if (coreError) {
      flushRuntimeCallbacks(coreError, null);
      return;
    }

    flushRuntimeCallbacks(null, settings);
  }

  function onBridgeScriptLoaded(settings, bridgeError) {
    if (bridgeError) {
      flushRuntimeCallbacks(bridgeError, null);
      return;
    }

    dispatchPageEvent('pbinfo-get-unsolved-extension-refresh-config');
    injectScriptFile('pbinfo-core.js', CORE_SCRIPT_ID, function (coreError) {
      onCoreScriptLoaded(settings, coreError);
    });
  }

  function onSettingsLoaded(settings) {
    updatePageSettings(settings);
    injectScriptFile('extension-bridge.js', BRIDGE_SCRIPT_ID, function (bridgeError) {
      onBridgeScriptLoaded(settings, bridgeError);
    });
  }

  function ensureRuntime(callback) {
    if (isCallable(callback)) {
      runtimeCallbacks.push(callback);
    }

    if (runtimeLoading) {
      return;
    }

    runtimeLoading = true;
    loadSettings(onSettingsLoaded);
  }

  function launchOverlay() {
    dispatchPageEvent('pbinfo-get-unsolved-extension-launch');
  }

  function setButtonStyles(button) {
    button.style.position = 'fixed';
    button.style.right = '16px';
    button.style.bottom = '16px';
    button.style.zIndex = '2147483647';
    button.style.border = '1px solid rgba(0,0,0,0.25)';
    button.style.borderRadius = '999px';
    button.style.padding = '9px 14px';
    button.style.fontSize = '13px';
    button.style.lineHeight = '1';
    button.style.fontFamily = 'system-ui,Segoe UI,Roboto,sans-serif';
    button.style.background = '#0f172a';
    button.style.color = '#f8fafc';
    button.style.boxShadow = '0 4px 18px rgba(2,6,23,0.32)';
    button.style.cursor = 'pointer';
  }

  function ensureStartButton() {
    if (document.getElementById(BUTTON_ID) != null || document.body == null) {
      return;
    }

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = 'Start scan';
    button.title = 'Ruleaza pbinfo-get-unsolved';
    setButtonStyles(button);

    button.addEventListener('mouseenter', function () {
      button.style.opacity = '0.9';
    });
    button.addEventListener('mouseleave', function () {
      button.style.opacity = '1';
    });
    button.addEventListener('click', function () {
      ensureRuntime(function (error) {
        if (error) {
          console.error('pbinfo-get-unsolved extension launch failed:', error);
          return;
        }

        launchOverlay();
      });
    });
    document.body.appendChild(button);
  }

  function onDomReady() {
    document.removeEventListener('DOMContentLoaded', onDomReady, false);
    ensureStartButton();
  }

  function onMessage(message, sender, sendResponse) {
    const type = message?.type;
    const senderTabId = sender?.tab?.id;

    if (type === 'pbinfo-launch') {
      ensureRuntime(function (error) {
        if (error) {
          sendResponse({ ok: false, error: error.message });
          return;
        }

        launchOverlay();
        sendResponse({ ok: true });
      });
      return true;
    }

    if (type === 'pbinfo-refresh-settings') {
      loadSettings(function (settings) {
        updatePageSettings(settings);
        sendResponse({ ok: true, settings: settings });
      });
      return true;
    }

    if (type === 'pbinfo-open-tab') {
      const opened = Number.isFinite(senderTabId)
        ? openTab(message?.url, getApi(), { openerTabId: senderTabId })
        : openTab(message?.url, getApi());

      sendResponse(opened ? { ok: true } : { ok: false, error: 'Unable to open tab.' });
      return false;
    }

    return false;
  }

  function attachMessageListener() {
    const api = getApi();

    if (isCallable(api?.runtime?.onMessage?.addListener)) {
      api.runtime.onMessage.addListener(onMessage);
    }
  }

  ensureRuntime();
  attachMessageListener();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDomReady, false);
  } else {
    ensureStartButton();
  }
})();
