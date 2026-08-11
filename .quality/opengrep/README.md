# Curated SAST ruleset (lean gate 4)

Pinned tool: **opengrep 1.22.0** (CI, installed by
`Prekzursil/quality-zero-platform/.github/workflows/reusable-quality.yml`) —
locally interchangeable with **semgrep CE** (opengrep is a fork of semgrep and
consumes the same rule syntax).

## Why an in-repo ruleset instead of `--config auto`

`--config auto` / `p/*` registry packs are fetched from the network at scan time
and change underneath you: a repo that is green today goes red tomorrow with no
change of yours. That externally-refreshing finding-set is exactly the treadmill
the lean charter exists to escape. A fixed, reviewable ruleset committed to the
repo makes the gate deterministic — same result every run, offline, no registry
login — so **zero is both reachable and stable**.

## Contents

Curated subset distilled from the relevant upstream packs (`p/javascript`,
`p/r2c-security-audit`), scoped to what this repo actually is: a **browser
userscript** (`pbinfo-get-unsolved-enhanced.js`) plus a small **Node build
script** (`scripts/build-bookmarklet.cjs`). This repo is 100% JavaScript
(`gh api repos/Prekzursil/pbinfo-get-unsolved/languages` → `{"JavaScript": …}`),
so there is no Python/Go/Java lane here.

- `javascript-security.yaml` — 12 rules: code-execution sinks (`eval`,
  `Function`, string-bodied timers), DOM-XSS sinks (`innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`), Node command-injection
  (`child_process.exec`), dynamic `require`, weak PRNG for secrets,
  `postMessage` wildcard origin, cleartext `http://` requests.
- `general-security.yaml` — 2 language-agnostic secret patterns (committed PEM
  private key, AWS access key id). Defence-in-depth alongside gate 5 (gitleaks),
  which uses a different engine.

## Running the gate

```bash
# CI (opengrep, exactly as reusable-quality.yml gate 4 invokes it):
opengrep scan --config .quality/opengrep --error \
  --exclude .venv --exclude node_modules --exclude dist --exclude out --exclude build .

# Local (semgrep CE, rule-compatible):
semgrep scan --config .quality/opengrep --error --metrics off \
  --exclude .venv --exclude node_modules --exclude dist --exclude out --exclude build .
```

Gate passes on **0 findings** (clean-zero lock; no baseline file).

## Suppressions

Genuine false positives are suppressed **inline** with a greppable
`// nosemgrep: <rule-id> -- <reason>` on the line above the finding. There are
no `paths: exclude` entries hiding real hits. Current suppressions
(`grep -rn nosemgrep`):

| site | rule | why |
|---|---|---|
| `pbinfo-get-unsolved-enhanced.js` `addLog()` | `js-inner-html-assignment` | `addLog` is an HTML-by-design log renderer: every caller passes markup composed in this file (`<b>`, `<span style>`, `<a href>`). The one interpolated URL (`pageLink`) has already been through `normalizeListUrl` → `new URL(...).toString()`, whose WHATWG serializer percent-encodes `<`, `>` and `"`. |
| `pbinfo-get-unsolved-enhanced.js` sortable table header | `js-inner-html-assignment` | The value is `` `${h.label} ${sortSymbol(h.key)}` `` — `h.label` is a hard-coded column label from a literal array and `sortSymbol` returns one of three literal HTML entities (`&#9660;`/`&#9650;`/`&#9654;`). No external data reaches this sink. `textContent` is not a drop-in replacement here because the entity would then render literally. |

**Known residual (NOT suppressed away, tracked separately):** because `addLog`
renders markup, a user who types a `javascript:` URL into the script's own
`prompt()` gets a clickable `javascript:` link in the log. That is self-inflicted
(the victim is the person who typed it) and no external page can reach it, so it
is not treated as a gate-blocking defect — but the correct hardening is to
reject non-`http(s)` schemes in `normalizeListUrl`.

## Refreshing against upstream

Upstream registry rules are Apache-2.0 / LGPL-2.1; rule logic is reproduced /
adapted here. To refresh, diff the registry packs and port new high-signal rules
in one-in-one-out, re-running the control fixtures below.

## Proving the ruleset can fire (do this on every change)

A ruleset that has never gone red is indistinguishable from an empty file. Both
states must be checked:

```bash
# KNOWN-BAD: must exit 1 and report every rule at least once
opengrep scan --config .quality/opengrep --error /path/to/deliberately-vulnerable.js
# KNOWN-GOOD: must exit 0 with 0 findings
opengrep scan --config .quality/opengrep --error /path/to/clean.js
```

Measured 2026-08-11 with opengrep 1.22.0: 14/14 rules fired on the known-bad
fixture (exit 1); 0 findings on the known-good fixture (exit 0).
