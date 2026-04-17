# pbinfo-get-unsolved — Chrome / Firefox Extension

Manifest V3 extension that wraps the userscript scanner for pbinfo.ro into a
browser-action popup, so users don't need a userscript manager.

## Build

```bash
npm ci
npm run build            # builds userscript + chrome.zip + firefox.xpi
npm run build:extension  # just the two extension archives
```

Outputs:

| File                                          | Target                            |
| --------------------------------------------- | --------------------------------- |
| `dist/pbinfo-get-unsolved-chrome-v<ver>.zip`  | Chrome, Edge, Brave, any Chromium |
| `dist/pbinfo-get-unsolved-firefox-v<ver>.xpi` | Firefox 115+ (MV3)                |

## Load unpacked (Chrome)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and point it at the `extension/` directory.
   (Or drag the `.zip` onto the page after packing.)
4. Navigate to <https://www.pbinfo.ro/>, click the toolbar icon, then **Start
   scan**.

## Load temporary (Firefox)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select the `.xpi` in `dist/` (or the
   `manifest.json` inside `extension/`).
3. Same flow: open pbinfo.ro, click the toolbar icon, **Start scan**.

## How it works

- `content/pbinfo-get-unsolved.content.js` injects `lib.js` (built from
  `pbinfo-get-unsolved-enhanced.js`) into the page's MAIN world so that
  `window.pbinfoGetUnsolvedStart` is defined on pbinfo pages.
- `background/service-worker.js` answers popup messages and uses
  `scripting.executeScript` to invoke `pbinfoGetUnsolvedStart` on demand.
- `popup/` is a small status UI that knows only whether the active tab is a
  pbinfo origin. All heavy logic stays in the page.

## Cross-browser notes

The template `manifest.template.json` is rendered into two variants:

| Key                               | Chrome  | Firefox                                 |
| --------------------------------- | ------- | --------------------------------------- |
| `background.service_worker`       | kept    | removed                                 |
| `background.scripts`              | removed | kept                                    |
| `browser_specific_settings.gecko` | removed | kept (`pbinfo-get-unsolved@prekzursil`) |

## Icons

Icons are generated deterministically at build time (`scripts/generate-icons.cjs`).
If you want to replace them with custom artwork, drop PNGs at
`extension/icons/icon-{16,32,48,128}.png` and the builder will pick them up.
