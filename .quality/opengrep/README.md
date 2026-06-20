# Curated SAST ruleset (Gate 4)

Pinned tool: **opengrep 1.22.0** (CI) — locally interchangeable with **semgrep CE**
(opengrep is a fork of semgrep and consumes the same rule syntax).

## Why an in-repo ruleset instead of `--config auto`

`--config auto` / `p/*` registry packs are fetched from the network at scan time and
change underneath you, which makes the gate **non-deterministic**. The lean model
requires a fixed, reviewable ruleset committed to the repo, so the gate produces the
same result every run, offline, with no registry login.

## Contents

This repo is a single browser bookmarklet (`pbinfo-get-unsolved-enhanced.js`) plus a
small Node build script and Node test suite. The ruleset is a **curated subset** of the
high-signal security rules from `p/javascript` and `p/r2c-security-audit` that actually
apply here:

- `javascript-security.yaml` — JS code-injection / command-injection / XSS-sink
  patterns (`eval`, `new Function`, `document.write`, `child_process.exec` with dynamic
  input).
- `general-security.yaml` — language-agnostic patterns (committed private keys, AWS
  access-key IDs).

### Deliberately omitted

- A generic `$EL.innerHTML = $X` rule is **intentionally not included**. This bookmarklet
  builds its entire UI by assigning template-literal HTML to `innerHTML` (the normal DOM
  idiom for a self-contained script with no framework); the values are author-controlled
  static markup, not untrusted input, so a blanket innerHTML rule would be pure noise.
  Re-add it (with inline `# nosemgrep` on the audited author-controlled sites) only if
  user-derived data ever flows into an `innerHTML` sink.

Upstream registry rules are Apache-2.0 / LGPL-2.1 licensed; rule logic is reproduced /
adapted here. To refresh against upstream, diff the registry packs and port new
high-signal rules in (one-in-one-out review).

## Running the gate

```bash
# CI (opengrep on Linux):
opengrep scan --config .quality/opengrep --error \
  --exclude node_modules --exclude dist --exclude out --exclude build .
```

Gate passes on **0 findings** (clean-zero lock; no baseline file). Genuine
false-positives are suppressed inline with a greppable `# nosemgrep: <rule-id> -- <reason>`.
