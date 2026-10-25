# Changelog

## Unreleased

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
