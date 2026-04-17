'use strict';

// Cross-browser reference: Firefox still exposes `browser.*`, Chrome uses `chrome.*`.
// Both conform to the MV3 events we need. We normalize once and proceed.
const api = typeof globalThis.browser === 'undefined' ? globalThis.chrome : globalThis.browser;

api.runtime.onInstalled.addListener(({ reason }) => {
  console.info('[pbinfo-get-unsolved] installed/upgraded:', reason);
});

// Respond to popup requests for the active tab's pbinfo origin so the popup
// can decide whether to show "Start scan" or a "Navigate to pbinfo first" hint.
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'PBINFO_GET_ACTIVE_ORIGIN') {
    (async () => {
      try {
        const [tab] = await api.tabs.query({ active: true, currentWindow: true });
        const url = tab?.url || '';
        let origin = '';
        try {
          origin = url ? new URL(url).origin : '';
        } catch {
          origin = '';
        }
        sendResponse({ ok: true, tabId: tab?.id ?? null, origin, url });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (message.type === 'PBINFO_TRIGGER_SCAN') {
    (async () => {
      try {
        const [tab] = await api.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          sendResponse({ ok: false, error: 'no-active-tab' });
          return;
        }
        await api.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            if (typeof globalThis.pbinfoGetUnsolvedStart === 'function') {
              globalThis.PBINFO_GET_UNSOLVED_NO_AUTORUN = true;
              globalThis.pbinfoGetUnsolvedStart();
            } else {
              console.error('[pbinfo-get-unsolved] content script not ready.');
            }
          },
          world: 'MAIN',
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  return false;
});
