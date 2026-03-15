(function () {
  'use strict';

  function setButtonStyles(button) {
    const styleEntries = [
      ['position', 'fixed'],
      ['right', '16px'],
      ['bottom', '16px'],
      ['zIndex', '2147483647'],
      ['border', '1px solid rgba(0,0,0,0.25)'],
      ['borderRadius', '999px'],
      ['padding', '9px 14px'],
      ['fontSize', '13px'],
      ['lineHeight', '1'],
      ['fontFamily', 'system-ui,Segoe UI,Roboto,sans-serif'],
      ['background', '#0f172a'],
      ['color', '#f8fafc'],
      ['boxShadow', '0 4px 18px rgba(2,6,23,0.32)'],
      ['cursor', 'pointer'],
    ];

    for (const [property, value] of styleEntries) {
      button.style[property] = value;
    }
  }

  function isCallable(value) {
    return Object.prototype.toString.call(value) === '[object Function]';
  }

  function onButtonClick() {
    if (isCallable(globalThis.pbinfoGetUnsolvedStart)) {
      globalThis.pbinfoGetUnsolvedStart();
      return;
    }

    console.error('pbinfoGetUnsolvedStart is not available.');
  }

  function ensureStartButton() {
    if (
      document.getElementById('pbinfo-get-unsolved-userscript-start') != null ||
      document.body == null
    ) {
      return;
    }

    const button = document.createElement('button');
    button.id = 'pbinfo-get-unsolved-userscript-start';
    button.type = 'button';
    button.textContent = 'Start scan';
    button.title = 'Ruleaza pbinfo-get-unsolved';
    setButtonStyles(button);
    button.addEventListener(
      'mouseenter',
      function () {
        button.style.opacity = '0.9';
      },
      false
    );
    button.addEventListener(
      'mouseleave',
      function () {
        button.style.opacity = '1';
      },
      false
    );
    button.addEventListener('click', onButtonClick, false);
    document.body.appendChild(button);
  }

  function onDomReady() {
    document.removeEventListener('DOMContentLoaded', onDomReady, false);
    ensureStartButton();
  }

  if (globalThis.__PBINFO_GET_UNSOLVED_USERSCRIPT_READY__) {
    return;
  }

  globalThis.__PBINFO_GET_UNSOLVED_USERSCRIPT_READY__ = true;
  globalThis.PBINFO_GET_UNSOLVED_NO_AUTORUN = true;

  if (globalThis.PBINFO_GET_UNSOLVED_OVERLAY === undefined) {
    globalThis.PBINFO_GET_UNSOLVED_OVERLAY = true;
  }

  /* __PBINFO_CORE_CODE__ */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDomReady, false);
  } else {
    ensureStartButton();
  }
})();
