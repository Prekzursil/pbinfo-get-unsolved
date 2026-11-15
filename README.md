# pbinfo-get-unsolved

Scanner pentru probleme pbinfo nerezolvate, cu focus pe workflow **userscript-first**.

<img width="1920" height="1080" alt="Screenshot" src="https://github.com/user-attachments/assets/604a2d1d-a318-4e7d-93d3-85603c8aa2ad" />

## Quick Start (Userscript)

### 1. Instalează un manager de userscript

- Chrome/Edge: Tampermonkey
- Firefox: Tampermonkey sau Violentmonkey

### 2. Instalează userscript-ul

- Dintr-un Release GitHub, descarcă `pbinfo-get-unsolved.userscript.js` și importă-l în manager.
- Sau deschide direct fișierul din `dist/pbinfo-get-unsolved.userscript.js`.

### 3. Rulează scanarea

1. Intră pe `https://www.pbinfo.ro/` și conectează-te.
2. Vei vedea butonul flotant **Start scan**.
3. Apasă butonul și urmează prompt-urile:
   - `1` = scanare listă (paginare)
   - `2` = scanare interval ID (`/probleme/<id>`)
   - `3` = scanare completă (tot spațiul de ID-uri `1..plafon` auto-detectat)

Implicit, userscript-ul pornește în overlay non-destructiv (nu îți golește pagina).

## Fallback: Console

Workflow-ul clasic rămâne suportat complet.

1. Intră pe pbinfo și autentifică-te.
2. Deschide consola browser (`Ctrl` + `Shift` + `J`).
3. Rulează conținutul din `pbinfo-get-unsolved-enhanced.js`.

Dacă vrei să controlezi explicit autorun-ul:

```js
window.PBINFO_GET_UNSOLVED_NO_AUTORUN = true;
// apoi rulezi scriptul
window.pbinfoGetUnsolvedStart();
```

## Fallback: Bookmarklet

```bash
npm ci
npm run build:bookmarklet
```

Se generează:

- `dist/pbinfo-get-unsolved.min.js`
- `dist/pbinfo-get-unsolved.bookmarklet.txt`
- `dist/pbinfo-get-unsolved.userscript.js`

Copiază conținutul din `pbinfo-get-unsolved.bookmarklet.txt` în URL-ul unui bookmark și rulează-l pe pbinfo.

## Funcționalități

- Mod listă + mod interval ID + mod complet (`all`).
- Retry cu backoff exponențial + jitter.
- Adaptive throttling (reduce concurența/crește delay când apar blocaje).
- Pause/Resume/Stop.
- Export rezultate filtrate: CSV / JSON / clipboard links / IDs / Markdown.
- Căutare client-side (ID/nume).
- Randare tabel în chunks (`requestAnimationFrame`) pentru liste mari.
- Opțiune de virtualizare (best-effort) pentru seturi foarte mari.
- Snapshot-uri locale multiple + import/export JSON.
- Migrare automată stări locale v1 -> v2 (citire legacy, scriere v2).

## Modul complet (`all`) — scanarea întregului spațiu de ID-uri

Modul `all` răspunde la întrebarea „chiar am toate problemele?". Categoriile
sunt utile, dar problemele ascunse, legate doar din alte pagini sau
mis-categorizate sunt invizibile pentru inventarul pe categorii. Modul
`all` scanează secvențial ID-urile `1..plafon` și capturăază **toate**
problemele, indiferent de stare (rezolvate/încercate/neîncercate — starea
rămâne marcată pe fiecare problemă, iar filtrele/tabelul/exporturile
existente funcționează neschimbat).

Cum funcționează:

- **Plafon auto-detectat**: un prober secvențial sondajează în fața
  ultimului ID viu (pas `PBINFO_GET_UNSOLVED_ALL_PROBE_STEP`). Când un
  sondaj e mort, verifică secvențial ID-urile imediat următoare; un run de
  `PBINFO_GET_UNSOLVED_ALL_DEAD_RUN` ID-uri moarte consecutive dovedește
  plafonul (`provenBy: dead-run`). Peste tot, `401/403` înseamnă „există,
  dar acces restricționat" (viu), iar `404` e singurul semnal „nu există".
  Capul dur `PBINFO_GET_UNSOLVED_ALL_MAX_CEILING` oprește sondajul
  (`provenBy: max-ceiling`) dacă plafonul real e dincolo de el.
- **Clasificare distinctă per ID**: `live` (capturat), `dead` (404 — skip
  permanent), `cookie-shell` (401/403 sau pagină 200 fără conținut de
  problemă — skip permanent), `transient` (blocked / erori HTTP / rețea —
  reîncercat cu backoff; după epuizarea retry-urilor intră pe skip-list cu
  motivul). Skip-list-ul persistă în snapshot cu motiv pentru fiecare ID.
- **Checkpoint/resume**: progresul (cursor, stare prober, skip-list,
  ID-uri în lucru) se salvează prin mecanismul existent de snapshot-uri și
  se reia automat. La resume, doar ID-urile `transient` sunt reîncercate.
- **Raport de diferențe**: la finalul unei scanări complete, scriptul
  compară ID-urile găsite cu inventarul tuturor snapshot-urilor de mod
  listă salvate local și raportează problemele găsite DOAR de scanarea
  completă (ascunse/fără categorie). Raportul se descarcă cu butonul
  „Raport diferențe" din grupul Export.

Configurare dedicată:

```js
window.PBINFO_GET_UNSOLVED_ALL_START = 1; // default 1 (ID-ul de start)
window.PBINFO_GET_UNSOLVED_ALL_PROBE_STEP = 25; // default 25 (pasul sondajului de plafon)
window.PBINFO_GET_UNSOLVED_ALL_DEAD_RUN = 10; // default 10 (ID-uri moarte consecutive care dovedesc plafonul)
window.PBINFO_GET_UNSOLVED_ALL_MAX_CEILING = 20000; // default 20000 (capul dur al sondajului)
```

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
window.PBINFO_GET_UNSOLVED_MODE = 'list'; // "list" | "id-range" | "all"
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
npm run test:coverage # 100% lines / branches / functions gate (also enforced in CI)
npm run lint
npm run format:check
npm run build:bookmarklet
```

## Release artifacts (GitHub)

Workflow-ul `Release` publică automat la tag `v*` (sau manual) următoarele fișiere:

- `dist/pbinfo-get-unsolved.userscript.js`
- `dist/pbinfo-get-unsolved.min.js`
- `dist/pbinfo-get-unsolved.bookmarklet.txt`
- `dist/checksums.sha256`

## Changelog

### Unreleased

- Userscript-first packaging cu buton persistent **Start scan**.
- Retry/backoff refactor: exponential backoff + jitter + adaptive throttling.
- Parsing fetched HTML pe `DOMParser`.
- Stocare v2 + migrare v1 + import/export snapshot JSON.
- Căutare în rezultate + randare tabel în chunks + virtualizare best-effort.
- Pipeline release artifacts + checksums.
