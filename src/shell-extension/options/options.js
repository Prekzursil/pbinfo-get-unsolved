(function () {
  const { DEFAULTS, storageGet, storageSet, queryTabs, sendTabMessage } = require('../shared');

  function setStatus(text, isError) {
    const status = document.getElementById('status');

    status.textContent = text;
    status.style.color = isError ? '#b91c1c' : '#475569';
  }

  function hydrate() {
    storageGet(DEFAULTS, function (settings) {
      document.getElementById('verify-unsolved').checked = settings.verifyUnsolved === true;
      document.getElementById('cache-enabled').checked = settings.cacheEnabled !== false;
      document.getElementById('force-refresh').checked = settings.forceRefresh === true;
      document.getElementById('cache-ttl').value = String(
        Math.max(1, Math.round((Number(settings.cacheTtlMs) || DEFAULTS.cacheTtlMs) / 60000))
      );
      document.getElementById('nav-scope').value = settings.navScope === 'all' ? 'all' : 'visible';
    });
  }

  function broadcastRefresh(tabs, done) {
    if (!tabs.length) {
      done();
      return;
    }

    sendTabMessage(tabs[0].id, { type: 'pbinfo-refresh-settings' }, function () {
      broadcastRefresh(tabs.slice(1), done);
    });
  }

  function onRefreshBroadcast() {
    setStatus('Setarile au fost salvate si propagate catre tab-urile pbinfo deschise.', false);
  }

  function onTabsQueried(tabs) {
    broadcastRefresh(tabs, onRefreshBroadcast);
  }

  function onSettingsStored(error) {
    if (error) {
      setStatus('Nu am putut salva setarile: ' + (error?.message || String(error)), true);
      return;
    }

    queryTabs({ url: ['https://www.pbinfo.ro/*'] }, onTabsQueried);
  }

  function readFormValues() {
    const cacheTtlInput = document.getElementById('cache-ttl').value || '15';
    const defaultCacheTtlMinutes = Math.max(1, Math.round(DEFAULTS.cacheTtlMs / 60000));
    const cacheTtlParsed = Number.parseInt(cacheTtlInput, 10);
    let cacheTtlMinutes = Number.isFinite(cacheTtlParsed) ? cacheTtlParsed : defaultCacheTtlMinutes;

    cacheTtlMinutes = Math.max(1, cacheTtlMinutes);

    return {
      verifyUnsolved: document.getElementById('verify-unsolved').checked,
      cacheEnabled: document.getElementById('cache-enabled').checked,
      forceRefresh: document.getElementById('force-refresh').checked,
      cacheTtlMs: cacheTtlMinutes * 60000,
      navScope: document.getElementById('nav-scope').value === 'all' ? 'all' : 'visible',
    };
  }

  function onSubmit(event) {
    const values = readFormValues();

    event.preventDefault();
    storageSet(values, onSettingsStored);
  }

  document.getElementById('options-form').addEventListener('submit', onSubmit, false);
  hydrate();
})();
