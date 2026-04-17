# Project Backlog

## Completed

Most historical backlog is archived — see git log pre-v3 or the
[CHANGELOG](CHANGELOG.md) for what shipped in v2.x. All items below are
post-v3.0.0.

## High priority

- [ ] Drive branch + line coverage on `pbinfo-get-unsolved-enhanced.js` from
      the current 95/19 pair to a full 100/100 without exclusions. Strategy:
      incrementally promote pure helpers out of the IIFE (as done for
      `buildStateKeys`), or exercise the IIFE under a linkedom-backed DOM
      harness.
- [ ] Verify each Quality Zero gate (Codacy, SonarCloud, QLTY, Semgrep,
      DeepSource, CodeQL, Codecov) reports 0 issues on the v3 PR, not just a
      green check rollup.
- [ ] Cut `v3.0.0` release with attached `dist/*.userscript.js`,
      `dist/*.bookmarklet.txt`, `dist/*chrome*.zip`, `dist/*firefox*.xpi`,
      and `dist/checksums.sha256`.

## Medium priority

- [ ] Publish the Chrome extension to the Chrome Web Store once icons and
      privacy-policy copy are finalized.
- [ ] Submit the Firefox `.xpi` to AMO for signing. The manifest already
      declares `browser_specific_settings.gecko.id =
      pbinfo-get-unsolved@prekzursil`.
- [ ] Add Playwright/Chrome DevTools smoke test that loads the extension
      against a static pbinfo HTML fixture and verifies the overlay appears.

## Low priority

- [ ] Translate the popup UI (currently Romanian-only) for en-US.
- [ ] Add a "paste custom URL" option to the popup for users who want to
      scan a category list without opening pbinfo first.
