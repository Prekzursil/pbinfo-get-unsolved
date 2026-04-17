# Project Backlog

## Completed

Most historical backlog is archived — see git log pre-v3 or the
[CHANGELOG](CHANGELOG.md) for what shipped in v2.x. All items below are
post-v3.0.0.

## High priority

- [ ] Drive branch + line coverage on `pbinfo-get-unsolved-enhanced.js`
      from the current 99.17 / 89.40 pair to a full 100/100 without
      exclusions. Remaining uncovered lines are concentrated in: (i)
      defensive storage-failure branches (`saveScanState`, `deleteSnapshotItem`);
      (ii) `restoreFromSavedState` active-request abort loop that only fires
      when `activeRequests.size > 0 && inFlight === 0` (not normally
      reachable); (iii) `DEBUG_IDS` .map/.filter chain (adding a test
      regresses unrelated coverage by ~1%); (iv) list-mode past-end
      (`startOffset >= totalProblems`) which also regresses when added.
- [ ] Verify each Quality Zero gate (Codacy, SonarCloud, QLTY, Semgrep,
      DeepSource, CodeQL, Codecov) reports 0 issues on the v3 PR, not just a
      green check rollup. Current status (PR #13): - PASS: test, CodeQL, DeepScan, DeepSource Visible Zero, Semgrep
      Zero, Sentry Zero, QLTY Zero, Quality Secrets Preflight, SonarCloud
      status check, Codecov Analytics, Dependency Alerts, Socket Security - FAIL: SonarCloud Code Analysis (3 hotspots + 3.6% duplication on
      new code, threshold ≤3%); qlty check (20 blocking: 12 duplication,
      4 deeply-nested flow, 3 many-returns, 1 total complexity);
      Codacy Static Analysis (100 issues; mostly Compatibility +
      ErrorProne, under investigation); Coverage 100 Gate (requires 100%).
- [ ] Cut `v3.0.0` release with attached `dist/*.userscript.js`,
      `dist/*.bookmarklet.txt`, `dist/*chrome*.zip`, `dist/*firefox*.xpi`,
      and `dist/checksums.sha256`.

## Medium priority

- [ ] Publish the Chrome extension to the Chrome Web Store once icons and
      privacy-policy copy are finalized.
- [ ] Submit the Firefox `.xpi` to AMO for signing. The manifest already
      declares the Gecko add-on id as `pbinfo-get-unsolved@prekzursil`.
- [ ] Add Playwright/Chrome DevTools smoke test that loads the extension
      against a static pbinfo HTML fixture and verifies the overlay appears.

## Low priority

- [ ] Translate the popup UI (currently Romanian-only) for en-US.
- [ ] Add a "paste custom URL" option to the popup for users who want to
      scan a category list without opening pbinfo first.
