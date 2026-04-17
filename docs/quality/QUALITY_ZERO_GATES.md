# Quality Zero Gates

This repository is configured for strict quality enforcement. The intent is
that main is always **truly green** across every gate, not just the CI run
itself.

## Targets

| Dimension             | Target                       | Enforcer                                      |
| --------------------- | ---------------------------- | --------------------------------------------- |
| Line coverage         | 100% (no exclusions)         | Codecov (`codecov.yml`) + `c8` (`.c8rc.json`) |
| Branch coverage       | 100% (no exclusions)         | Codecov + `c8`                                |
| Statement coverage    | 100% (no exclusions)         | Codecov + `c8`                                |
| Function coverage     | 100% (no exclusions)         | `c8`                                          |
| Sonar quality gate    | 0 issues, 0 hotspots         | SonarCloud                                    |
| Codacy grade          | 0 issues                     | Codacy                                        |
| QLTY                  | 0 smells (`mode = "block"`)  | `.qlty/qlty.toml`                             |
| Semgrep               | 0 findings                   | Semgrep Zero (reusable workflow)              |
| DeepSource / DeepScan | 0 findings                   | Prekzursil/quality-zero-platform              |
| Dependabot            | 0 open alerts (any severity) | GitHub                                        |
| CodeQL                | 0 alerts                     | Managed CodeQL baseline                       |
| Secrets preflight     | pass                         | Aggregated gate                               |

## Where the rules live

- `.c8rc.json` — c8 coverage configuration. `include` lists the main script
  and any `src/` module; no `excludeAfterRemap` / per-file ignore is used.
- `codecov.yml` — Codecov project + patch target at 100%, 0% threshold.
- `sonar-project.properties` — Sonar exclusions are limited to CI governance
  and managed wrappers (`.github/**`, `scripts/quality/**`, `.qlty/**`), not
  product code.
- `.qlty/qlty.toml` — QLTY runs in `block` mode so any smell fails the gate.
- `.github/workflows/quality-zero-platform.yml` + `quality-zero-gate.yml` —
  reusable workflows maintained in
  [`Prekzursil/quality-zero-platform`](https://github.com/Prekzursil/quality-zero-platform).

## How to debug a red gate

1. **CI summary** in the PR check tab — the aggregated gate lists every
   scanner and whether it passed, failed, or was skipped.
2. **Coverage** — download the `coverage-report` artifact from the CI run and
   open `coverage/lcov-report/index.html` locally.
3. **Extension** — download the `extension-artifacts` artifact and install it
   via `chrome://extensions` or `about:debugging` to smoke-test.
4. **Sonar / Codacy / DeepScan** dashboards need a login on the respective
   SaaS — their scanners only surface summaries in GitHub checks.

## No exclusions policy

Do not add file-level or line-level coverage exclusions to silence a failing
gate. The expected remediation is either:

- write a test that exercises the missing path, or
- refactor the code so the dead branch is impossible (and then delete it).

If coverage on a DOM-heavy surface looks impossible, the recommended approach
is to extract the logic into a pure helper (see how `buildStateKeys` was
promoted out of the browser IIFE in v3.0.0) and test the helper directly.

## Operational rules

- If required tokens / variables are missing, workflows fail by design —
  don't silently skip the gate.
- A passing CI run with missing scanners counts as a **false green**; the
  aggregated gate in `Prekzursil/quality-zero-platform` asserts that every
  scanner actually reported.
- When a Dependabot / security advisory lands on main, treat it as a red gate
  and fix immediately. `npm audit fix` is usually enough for transitive
  advisories.
