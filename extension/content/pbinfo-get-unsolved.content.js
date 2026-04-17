'use strict';

// The content script runs in an isolated world by default, but MV3 lets us
// reach the page's MAIN world via scripting.executeScript when the popup asks
// for a scan. Here we inject the bundled userscript source as a <script>
// element so that its IIFE defines window.pbinfoGetUnsolvedStart on the page.

(function injectLibrary() {
  if (window.__PBINFO_GET_UNSOLVED_EXT_READY__) return;
  window.__PBINFO_GET_UNSOLVED_EXT_READY__ = true;

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const libUrl = api.runtime.getURL('content/pbinfo-get-unsolved.lib.js');

  const s = document.createElement('script');
  s.src = libUrl;
  s.async = false;
  s.addEventListener('load', () => s.remove(), { once: true });
  (document.head || document.documentElement).appendChild(s);
})();
