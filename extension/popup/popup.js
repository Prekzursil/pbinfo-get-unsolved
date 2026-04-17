'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

const startBtn = document.getElementById('start');
const statusEl = document.getElementById('status');
const subtitleEl = document.getElementById('subtitle');
const versionEl = document.getElementById('version');

function setStatus(msg, kind) {
  statusEl.className = 'status' + (kind ? ` ${kind}` : '');
  statusEl.textContent = msg || '';
}

function setSubtitleNavigateHint() {
  // Build DOM explicitly — no innerHTML — to keep CSP strict and avoid XSS.
  while (subtitleEl.firstChild) subtitleEl.removeChild(subtitleEl.firstChild);
  subtitleEl.appendChild(document.createTextNode('Navighează la '));
  const a = document.createElement('a');
  a.href = 'https://www.pbinfo.ro/';
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'pbinfo.ro';
  subtitleEl.appendChild(a);
  subtitleEl.appendChild(document.createTextNode(' în tab-ul activ, apoi reîncarcă acest popup.'));
}

function isPbinfoOrigin(origin) {
  return origin === 'https://www.pbinfo.ro' || origin === 'https://pbinfo.ro';
}

async function refreshActiveTab() {
  try {
    const resp = await api.runtime.sendMessage({ type: 'PBINFO_GET_ACTIVE_ORIGIN' });
    if (!resp?.ok) {
      setStatus(resp?.error || 'Eroare la detectarea tab-ului activ.', 'err');
      startBtn.disabled = true;
      return;
    }
    if (!isPbinfoOrigin(resp.origin)) {
      startBtn.disabled = true;
      setSubtitleNavigateHint();
      setStatus(`Tab curent: ${resp.origin || '(necunoscut)'}`);
      return;
    }
    startBtn.disabled = false;
    subtitleEl.textContent = 'Gata de scanare. Poți alege modul în pagină (listă vs ID range).';
    setStatus('');
  } catch (err) {
    setStatus(String(err?.message || err), 'err');
    startBtn.disabled = true;
  }
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  setStatus('Pornire scanare...');
  try {
    const resp = await api.runtime.sendMessage({ type: 'PBINFO_TRIGGER_SCAN' });
    if (resp?.ok) {
      setStatus('Scanarea a fost lansată în tab.', 'ok');
      setTimeout(() => window.close(), 600);
    } else {
      setStatus(resp?.error || 'Lansare eșuată.', 'err');
      startBtn.disabled = false;
    }
  } catch (err) {
    setStatus(String(err?.message || err), 'err');
    startBtn.disabled = false;
  }
});

(async () => {
  try {
    const manifest = api.runtime.getManifest();
    if (manifest?.version) versionEl.textContent = `v${manifest.version}`;
  } catch {}
  await refreshActiveTab();
})();
