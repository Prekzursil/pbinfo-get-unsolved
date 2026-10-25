# Repository health audit — 2026-10

Audit scope: full clone of `Prekzursil/pbinfo-get-unsolved` at `main` = `84b70c7`
("CI: wire the QZP lean gate (zero tolerance) (#25)"), all 294 commits and all
20 remote branches.

## Checks run and results

All commands were run from a clean checkout (`npm ci` first). Exact commands:

| Check                   | Command                                     | Result                                                                                                                         |
| ----------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Unit tests              | `npm test` (node:test)                      | 127 tests, **127 pass / 0 fail / 0 skipped**                                                                                   |
| Coverage gate           | `npm run test:coverage`                     | **passes** with thresholds `--test-coverage-lines=100 --test-coverage-branches=100 --test-coverage-functions=100`              |
| Lint                    | `npm run lint` (eslint .)                   | clean, no output                                                                                                               |
| Format                  | `npm run format:check` (prettier --check .) | "All matched files use Prettier code style!"                                                                                   |
| Build                   | `npm run build:bookmarklet`                 | writes `dist/pbinfo-get-unsolved.min.js`, `dist/pbinfo-get-unsolved.userscript.js`, `dist/pbinfo-get-unsolved.bookmarklet.txt` |
| GitHub checks on `main` | `gh run list --branch main`                 | CI, quality (QZP lean gate), CodeQL: all `success` on the latest push (2026-10-24)                                             |

### Exact coverage numbers (from `coverage/lcov.info` for `pbinfo-get-unsolved-enhanced.js`)

- Lines: 4028 hit / 4028 found — **100.00%**
- Branches: 389 hit / 389 found — **100.00%**
- Functions: 55 hit / 55 found — **100.00%**

`scripts/build-bookmarklet.cjs` is a build tool and is not loaded by the test
suite, so it does not appear in the node:test coverage report.

## Fixes applied in this audit

1. **CI did not enforce the coverage gate.** `.github/workflows/ci.yml` ran
   `npm test` but never `npm run test:coverage`, so the repo's own 100%
   lines/branches/functions gate was local-only. CI now runs it on every PR and
   push to `main`.
2. **Stale, conflicting pull requests closed** (would have regressed `main` if
   merged):
   - #21 (`fix/js-yaml-quadratic-cpu-ghsa-52cp`): bumps js-yaml to 4.3.0, but
     `main` already pins **4.3.2** in `package-lock.json` (via Dependabot,
     2026-10-18), which is past the GHSA-52cp-r559-cp3m fix.
   - #23 (`fix/codeql-addlog-innerhtml-clean`): rebuilds the `addLog` timestamp
     with DOM text nodes, but `main` already ships that fix in a stronger form —
     `addLog` at `pbinfo-get-unsolved-enhanced.js:1265` builds the stamp with
     `textContent` and renders the message through the whitelist-based
     `appendLogMarkup`, never through `innerHTML`. The PR's own quality check was
     failing.
   - #24 (`feat/opengrep-ruleset`): adds `.quality/opengrep/` (already present
     on `main`) and `nosemgrep` annotations for an `innerHTML`-based `addLog`
     that no longer exists on `main`.

## pbinfo problem proposals: search result

The audit specifically searched for a catalog of the owner's pbinfo problem
proposals. **None exists in this repository.**

- `git grep -niE "propun|proposal|propus"` across all files and across every
  commit in `git rev-list --all`: no hits.
- The only `pbinfo.ro/probleme/<id>` links in the entire history are URL
  templates inside the tool itself and its test fixtures
  (`tests/fixtures/problem-page-*.html`, `tests/state-snapshot.test.js`).
- No file list on any of the 20 remote branches contains a proposal/candidate
  document; deleted files across history are only quality-governance docs and
  the pre-rewrite script (`pbinfo-get-unsolved.js`).

## Notes

- The tool fetches only pbinfo.ro pages (`/probleme/...` lists and problem
  pages, plus `ajx-module/json-probleme-scor.php` for batched scores) with the
  browsing user's session. All tests run against local HTML fixtures; no live
  scraping happens in CI or in the test suite.
- Windows checkouts: `core.autocrlf=true` makes `npm run format:check` fail
  locally on ~40 files (CRLF in the working tree). The blobs in git are
  LF-normalized and Linux CI passes; use `git config core.eol lf` (or check out
  with `autocrlf=false` + `core.eol=lf`) before running the format check on
  Windows.
