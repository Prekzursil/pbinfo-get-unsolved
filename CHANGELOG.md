# Changelog

All notable changes to this project are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## Unreleased

_Nothing yet. See v3.0.0 for the current release._

## v3.0.0

### Added

- **Chrome / Firefox MV3 extension** (`extension/`, built as
  `dist/pbinfo-get-unsolved-chrome-vX.Y.Z.zip` and
  `dist/pbinfo-get-unsolved-firefox-vX.Y.Z.xpi`). The extension bundles the
  userscript core as a content-script library and exposes a toolbar popup with a
  single `Start scan` action.
- **Reproducible extension build** (`scripts/build-extension.cjs` +
  `scripts/generate-icons.cjs`) — zero extra runtime dependencies; zip + png
  generation uses only `zlib`.
- **Branch + line coverage instrumentation** via `c8` (`.c8rc.json`,
  `npm run test:coverage`), with targets set to 100/100/100/100 and no
  source-level exclusions.
- **Promoted pure helpers** out of the browser IIFE so they are testable in
  Node: `safeJsonParse`, `fnv1a32`, `classifyStorageError`, `formatDateTime`,
  `formatDuration`, `normalizeScanMode`, `parseIdRangeInput`,
  `normalizeSnapshotIndex`, `buildStateKeys`, `quicksortByKey`,
  `toggleSortedState`, `filterProblems`, `parseHtmlDocument`,
  `shouldEmitDebugDump`, `describeClipboardError`,
  `projectSnapshotForLevel`, `sanitizeForDebugLog`, `numberToDifficulty`,
  `difficultyColor`, `statusLabel`, `statusColor`, `formatRetryDelayLabel`,
  `parseIdRangeScoreValue`, `idRangeBatchStartForId`,
  `serializeFilterState`, `storageGetJson`, `storageSetJson`,
  `storageRemove`, `effectiveDelayMs`, `effectiveConcurrency`,
  `resolveThemeValue`, `loadStoredTheme`, `applyThemeAttribute`,
  `copyTextViaClipboardApi`, `copyTextViaExecCommand`, `computeRenderShape`,
  `computeScanSummary`, `computeEta`, `formatProgressText`,
  `formatVirtualizationBanner`, `formatIdRangeProgressLog`,
  `formatFetchRetryLog`, `redactScoreCandidates`, `safePbinfoFetchUrl`,
  `resolveSnapshotLevels`, `problemMatchesSearch`, `problemMatchesScore`.
- **In-IIFE refactor helpers** that reduce duplication for qlty /
  SonarCloud (no behavior change): `maybeLogIdRangeProgress`,
  `handleCloudflareBlock`, `addIdRangeProblemEntry`.
- **Linkedom-backed DOM harness** (`tests/iife-harness.test.js`) that boots
  the browser IIFE under a Node-side window stub to exercise DOM-bound
  handlers without shipping the code as a separate module.
- **New test suites** — 220 tests across 13 files covering pure helpers,
  DOM fixtures, the extension build pipeline, snapshot persistence,
  response-error paths, and scan-mode orchestration.

### Changed

- `normalizeSnapshotIndex` now accepts an options object
  (`{ storageVersion, legacyVersion }`) instead of closing over IIFE constants.
  The IIFE calls it with the previous defaults.
- The in-IIFE `makeStateKeys` delegates to the new top-level `buildStateKeys`.
- CI builds and uploads coverage + extension artifacts so the Quality Zero
  Platform gates can ingest them.

### Security

- `npm audit fix` resolves Dependabot alert #7 (high: Prototype Pollution via
  `parse()` in NodeJS `flatted`) plus two moderate advisories
  (`brace-expansion`, `ajv`).

## v2.0.0

- Userscript-first packaging (`dist/pbinfo-get-unsolved.userscript.js`) with
  persistent `Start scan` trigger.
- Backoff rewrite to exponential backoff with optional jitter plus adaptive
  throttling.
- Network layer migrated to `fetch` + `AbortController` with stop/pause-safe
  cancellation behavior.
- Fetched HTML parsing migrated to `DOMParser`.
- Local state upgraded to storage schema v2 with v1 compatibility reads and
  migration helpers.
- Added snapshot JSON export/import flow in UI.
- Added client-side search filter, chunked table rendering, and optional row
  virtualization flags.
- Added release automation workflow that publishes build artifacts and checksum
  file.
