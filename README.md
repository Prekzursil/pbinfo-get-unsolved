# pbinfo-get-unsolved

Scanner pentru probleme pbinfo nerezolvate, disponibil ca **extensie de browser** (Chrome / Firefox), **userscript**, **bookmarklet** sau direct în consolă.

<img width="1920" height="1080" alt="Screenshot" src="https://github.com/user-attachments/assets/604a2d1d-a318-4e7d-93d3-85603c8aa2ad" />

## Quick Start — alege un canal

| Canal | Recomandat pentru | Instalare |
| --- | --- | --- |
| **Extensie Chrome / Edge / Brave** | Cel mai simplu pe orice Chromium | [`pbinfo-get-unsolved-chrome-vX.Y.Z.zip`](#extensie-chrome) din Releases |
| **Extensie Firefox (MV3)** | Firefox 115+ | [`pbinfo-get-unsolved-firefox-vX.Y.Z.xpi`](#extensie-firefox) din Releases |
| **Userscript (Tampermonkey etc.)** | Control complet peste script | `pbinfo-get-unsolved.userscript.js` din Releases |
| **Bookmarklet** | Setup one-shot, fără manager | `pbinfo-get-unsolved.bookmarklet.txt` |
| **Consolă dev tools** | Debugging sau rulare ad-hoc | `pbinfo-get-unsolved-enhanced.js` copy-paste |

### Extensie Chrome

1. Deschide `chrome://extensions`, activează **Developer mode**.
2. Dezarhivează `.zip`-ul din Releases și alege **Load unpacked** pe folder.
3. Navighează la `https://www.pbinfo.ro/`, apasă iconița din toolbar, apoi **Start scan**.

### Extensie Firefox

1. Deschide `about:debugging#/runtime/this-firefox`.
2. Click pe **Load Temporary Add-on** și selectează `.xpi`-ul.
3. Flux identic: pbinfo.ro → iconița din toolbar → **Start scan**.

Pentru instalare permanentă trebuie să semnezi extensia via [AMO](https://addons.mozilla.org/).
Cheia `browser_specific_settings.gecko.id` (= `pbinfo-get-unsolved@prekzursil`) este deja pregătită.

### Userscript

1. Instalează [Tampermonkey](https://www.tampermonkey.net/) sau
   [Violentmonkey](https://violentmonkey.github.io/).
2. Descarcă `pbinfo-get-unsolved.userscript.js` și importă-l în manager.
3. Intră pe `https://www.pbinfo.ro/` și apasă butonul flotant **Start scan**.

### Bookmarklet

```bash
npm ci
npm run build:bookmarklet
```

Copiază conținutul din `dist/pbinfo-get-unsolved.bookmarklet.txt` în URL-ul unui
bookmark. Salvează și rulează-l pe pbinfo.

### Consolă

1. Intră pe pbinfo și autentifică-te.
2. Deschide consola (`Ctrl` + `Shift` + `J`).
3. Rulează conținutul din `pbinfo-get-unsolved-enhanced.js`.

Pentru a dezactiva pornirea automată:

```js
window.PBINFO_GET_UNSOLVED_NO_AUTORUN = true;
// apoi lansezi manual:
window.pbinfoGetUnsolvedStart();
```

## Build local

```bash
npm ci
npm run build   # userscript + bookmarklet + chrome.zip + firefox.xpi
```

Output în `dist/`:

- `pbinfo-get-unsolved.userscript.js`
- `pbinfo-get-unsolved.min.js`
- `pbinfo-get-unsolved.bookmarklet.txt`
- `pbinfo-get-unsolved-chrome-vX.Y.Z.zip`
- `pbinfo-get-unsolved-firefox-vX.Y.Z.xpi`

Testare și coverage:

```bash
npm test              # node's built-in test runner (fast, no deps)
npm run test:coverage # c8 lcov + cobertura + json-summary în coverage/
npm run lint
npm run format:check
```

## Funcționalități

- Mod listă + mod interval ID.
- Retry cu backoff exponențial + jitter.
- Adaptive throttling (reduce concurența/crește delay când apar blocaje).
- Pause/Resume/Stop.
- Export rezultate filtrate: CSV / JSON / clipboard links / IDs / Markdown.
- Căutare client-side (ID/nume).
- Randare tabel în chunks (`requestAnimationFrame`) pentru liste mari.
- Opțiune de virtualizare (best-effort) pentru seturi foarte mari.
- Snapshot-uri locale multiple + import/export JSON.
- Migrare automată stări locale v1 -> v2 (citire legacy, scriere v2).

## Config avansat

Poți seta variabile înainte de pornire:

```js
// performanță / rețea
window.PBINFO_GET_UNSOLVED_CONCURRENCY = 2; // default 1
window.PBINFO_GET_UNSOLVED_DELAY_MS = 100; // default 0
window.PBINFO_GET_UNSOLVED_TIMEOUT_MS = 30000; // default 30000
window.PBINFO_GET_UNSOLVED_MAX_RETRIES = 3; // default 3
window.PBINFO_GET_UNSOLVED_START_PAGE = 1; // default 1
window.PBINFO_GET_UNSOLVED_MAX_PAGES = 5000; // default 5000

// backoff + adaptive throttling
window.PBINFO_GET_UNSOLVED_ADAPTIVE_THROTTLE = true; // default true
window.PBINFO_GET_UNSOLVED_BACKOFF_BASE_MS = 500; // default 500
window.PBINFO_GET_UNSOLVED_BACKOFF_CAP_MS = 15000; // default 15000
window.PBINFO_GET_UNSOLVED_BACKOFF_JITTER = true; // default true

// autosave/local state
window.PBINFO_GET_UNSOLVED_AUTOSAVE = true; // default true
window.PBINFO_GET_UNSOLVED_AUTOSAVE_PAGES = 50; // default 50
window.PBINFO_GET_UNSOLVED_AUTOSAVE_MS = 120000; // default 120000
window.PBINFO_GET_UNSOLVED_SNAPSHOTS_MAX = 8; // default 8

// mod scanare
window.PBINFO_GET_UNSOLVED_MODE = 'list'; // "list" | "id-range"
window.PBINFO_GET_UNSOLVED_MODE_PROMPT = true; // default true
window.PBINFO_GET_UNSOLVED_ID_START = 1; // default 1
window.PBINFO_GET_UNSOLVED_ID_END = 8000; // default 8000
window.PBINFO_GET_UNSOLVED_ID_MISSING_STOP = 0; // default 0
window.PBINFO_GET_UNSOLVED_ID_LOG_EVERY = 200; // default 200
window.PBINFO_GET_UNSOLVED_ID_SCORE_BATCH = true; // default true
window.PBINFO_GET_UNSOLVED_ID_SCORE_BATCH_SIZE = 200; // default 200

// UI / render
window.PBINFO_GET_UNSOLVED_OVERLAY = false; // default false în scriptul brut; userscript setează true dacă nu e definit
window.PBINFO_GET_UNSOLVED_LIVE_RENDER = false; // default false
window.PBINFO_GET_UNSOLVED_LIVE_RENDER_EVERY_PAGES = 2; // default 2
window.PBINFO_GET_UNSOLVED_LIVE_RENDER_MIN_MS = 750; // default 750
window.PBINFO_GET_UNSOLVED_RENDER_CHUNK_SIZE = 150; // default 150
window.PBINFO_GET_UNSOLVED_VIRTUALIZE_ROWS = false; // default false
window.PBINFO_GET_UNSOLVED_VIRTUAL_ROWS_LIMIT = 1200; // default 1200

// paginare
window.PBINFO_GET_UNSOLVED_PAGE_SIZE = 10; // default auto
window.PBINFO_GET_UNSOLVED_PAGINATION_MODE = 'offset'; // "offset" | "page"
window.PBINFO_GET_UNSOLVED_PAGE_PARAM = 'start'; // default "start"
window.PBINFO_GET_UNSOLVED_PAGE_BASE = 1; // pentru mode="page"
```

## Snapshot-uri, migrare și portabilitate

- Schema curentă stocare locală: **v2**.
- Scriptul citește și stări legacy v1, apoi operează/salvează în v2.
- În UI (`Stare (local)`):
  - `Snapshot` salvează un snapshot complet.
  - `Export JSON` exportă starea selectată.
  - `Import JSON` importă un snapshot (cu validare + migrare).

Pentru scanări lungi:

- autosave salvează progres compact (ca să reducă jank/quota pressure)
- snapshot-uri complete la pauză/acțiune explicită

## Troubleshooting

### Apare pagină anti-bot / challenge

- Lasă `ADAPTIVE_THROTTLE=true`.
- Scade `CONCURRENCY` (1-2) și crește `DELAY_MS` (100-300+).
- În modul ID, păstrează delay mic dar non-zero.

### Clipboard nu merge

- Clipboard API poate fi blocat de browser sau context.
- Scriptul încearcă fallback `execCommand('copy')`.
- Dacă tot eșuează, folosește export JSON/CSV și copy manual.

### localStorage plin

- Scriptul încearcă fallback pe snapshot/progres mai compact.
- Exportă snapshot-uri în JSON și șterge intrări vechi din UI dacă e nevoie.

## Development

```bash
npm ci
npm test
npm run test:coverage
npm run lint
npm run format:check
npm run build            # userscript + bookmarklet + chrome.zip + firefox.xpi
```

## Quality gates

| Semnal | Unde | Țintă |
| --- | --- | --- |
| Tests | `npm test` / CI | 100% pass |
| Coverage | Codecov, Codacy, Sonar, QLTY | 100% line + 100% branch (fără excluderi) |
| Lint | ESLint | 0 erori |
| Format | Prettier | 0 diferențe |
| Securitate | CodeQL, Semgrep, Dependabot | 0 alerte active |

Vezi [`docs/quality/QUALITY_ZERO_GATES.md`](docs/quality/QUALITY_ZERO_GATES.md) pentru detalii.

## Release artifacts (GitHub)

Workflow-ul `Release` publică automat la tag `v*` (sau manual) următoarele fișiere:

- `dist/pbinfo-get-unsolved.userscript.js`
- `dist/pbinfo-get-unsolved.min.js`
- `dist/pbinfo-get-unsolved.bookmarklet.txt`
- `dist/pbinfo-get-unsolved-chrome-vX.Y.Z.zip`
- `dist/pbinfo-get-unsolved-firefox-vX.Y.Z.xpi`
- `dist/checksums.sha256`

## Changelog

Vezi [`CHANGELOG.md`](CHANGELOG.md). Pe scurt: 3.0.0 aduce extensia Chrome/Firefox și gate-urile Quality Zero la 100% coverage.
