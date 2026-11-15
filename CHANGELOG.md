# Changelog

## Unreleased

- Added scan mode `all` (prompt option `3` / `window.PBINFO_GET_UNSOLVED_MODE = 'all'`): a full ID-space sweep `1..auto-detected ceiling` that captures every live problem regardless of solved state (status stays marked per problem, so existing tables/filters/exports work unchanged).
- Mode `all` auto-detects the ceiling by probing past the last live ID (step `PBINFO_GET_UNSOLVED_ALL_PROBE_STEP`) until a run of `PBINFO_GET_UNSOLVED_ALL_DEAD_RUN` consecutive dead IDs proves the max; a hard cap `PBINFO_GET_UNSOLVED_ALL_MAX_CEILING` bounds the probe. `401/403` count as "exists, access-restricted" for the ceiling; `404` is the only "does not exist" signal.
- Mode `all` classifies every settled ID distinctly as `live` / `dead` / `cookie-shell` / `transient`, keeps a persistent skip-list with per-ID reasons, and retries only `transient` IDs (exhausted retries land on the skip-list with their reason).
- Mode `all` checkpoints cursor, prober state, pending IDs and skip-list through the existing snapshot machinery and resumes from it; on resume only transient IDs are retried.
- Mode `all` finishes with a hidden/miscategorized diff report (full-sweep IDs vs. every saved `list`-mode snapshot inventory), logged at completion, persisted in the snapshot, and downloadable via a new "Raport diferențe" export button.

- CI now enforces the full coverage gate (`npm run test:coverage`: 100% lines, branches and functions) on every PR and push, not just locally.
- CI and Release workflows moved from Node 20 (EOL) to Node 22: the coverage-gate CLI flags (`--test-coverage-lines` etc.) do not exist on Node 20, which made `npm run test:coverage` fail on CI runners.
- Added `docs/repo-audit.md` with the 2026-10 repository health audit (test/coverage metrics, stale-PR cleanup, problem-proposal catalog search result).
- Closed superseded stale PRs (#21, #23, #24) whose branches predate fixes already on `main`; see the audit doc for the evidence.
- Userscript-first packaging (`dist/pbinfo-get-unsolved.userscript.js`) with persistent `Start scan` trigger.
- Backoff rewrite to exponential backoff with optional jitter plus adaptive throttling.
- Network layer migrated to `fetch` + `AbortController` with stop/pause-safe cancellation behavior.
- Fetched HTML parsing migrated to `DOMParser`.
- Local state upgraded to storage schema v2 with v1 compatibility reads and migration helpers.
- Added snapshot JSON export/import flow in UI.
- Added client-side search filter, chunked table rendering, and optional row virtualization flags.
- Added release automation workflow that publishes build artifacts and checksum file.
