(function () {
  const {
    DEFAULTS,
    getApi,
    storageGet,
    queryTabs,
    sendTabMessage,
    openTab,
    isCallable,
  } = require('../shared');

  function setStatus(text, isError) {
    const status = document.getElementById('status');

    status.textContent = text;
    status.style.color = isError ? '#b91c1c' : '#475569';
  }

  function isPbinfoTab(tab) {
    return Number.isFinite(tab?.id) && tab?.url?.startsWith('https://www.pbinfo.ro/') === true;
  }

  function renderSummary(settings) {
    const summary = document.getElementById('summary');
    const cacheText = settings.cacheEnabled === false ? 'off' : 'on';
    const verifyText = settings.verifyUnsolved ? 'on' : 'off';
    const refreshText = settings.forceRefresh ? 'on' : 'off';
    const navText = settings.navScope === 'all' ? 'all' : 'visible';

    summary.textContent =
      'verify=' +
      verifyText +
      ' · cache=' +
      cacheText +
      ' · force-refresh=' +
      refreshText +
      ' · nav=' +
      navText;
  }

  function refreshSummary() {
    storageGet(DEFAULTS, function (settings) {
      renderSummary(settings);
    });
  }

  function onLaunchClick() {
    queryTabs({ active: true, currentWindow: true }, function (tabs) {
      const activeTab = tabs[0];

      if (isPbinfoTab(activeTab)) {
        sendTabMessage(activeTab.id, { type: 'pbinfo-launch' }, function (result) {
          const ok = Boolean(result?.ok);
          let text;

          if (ok) {
            text = 'Overlay-ul a fost lansat.';
          } else {
            text = 'Launch esuat: ' + (result?.error || 'necunoscut');
          }

          setStatus(text, ok === false);
        });
        return;
      }

      openTab('https://www.pbinfo.ro/');
      setStatus('Am deschis pbinfo.ro. Apasa din nou Launch overlay pe pagina pbinfo.', false);
    });
  }

  function onOpenOptionsClick() {
    const api = getApi();

    if (isCallable(api?.runtime?.openOptionsPage)) {
      api.runtime.openOptionsPage();
    }
  }

  document.getElementById('launch').addEventListener('click', onLaunchClick, false);
  document.getElementById('open-pbinfo').addEventListener(
    'click',
    function () {
      openTab('https://www.pbinfo.ro/');
    },
    false
  );
  document.getElementById('open-options').addEventListener('click', onOpenOptionsClick, false);

  refreshSummary();
})();
