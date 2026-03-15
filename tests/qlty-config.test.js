const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('qlty is configured with repo-local defaults and coverage upload wiring', () => {
  const qltyToml = readRepoFile('.qlty/qlty.toml');
  const codecovWorkflow = readRepoFile('.github/workflows/codecov-analytics.yml');
  const aggregateWorkflow = readRepoFile('.github/workflows/quality-zero-gate.yml');

  assert.match(qltyToml, /^config_version = "0"$/m);
  assert.match(qltyToml, /\[\[source\]\]\s+name = "default"\s+default = true/s);
  assert.match(qltyToml, /exclude_patterns = \[/);
  assert.match(qltyToml, /\[smells\]\s+mode = "comment"/s);
  assert.match(qltyToml, /\[\[plugin\]\]\s+name = "actionlint"\s+mode = "block"/s);
  assert.match(
    qltyToml,
    /\[\[plugin\]\]\s+name = "prettier"\s+version = "3\.4\.2"\s+mode = "block"/s
  );
  assert.match(qltyToml, /"tests\/\*\*"/);
  assert.match(qltyToml, /"docs\/\*\*"/);
  assert.match(qltyToml, /"\.github\/\*\*"/);
  assert.match(qltyToml, /"package-lock\.json"/);
  assert.match(qltyToml, /"tests\/\*\*\/\*\.test\.js"/);

  assert.match(codecovWorkflow, /id-token: write/);
  assert.match(
    codecovWorkflow,
    /qltysh\/qlty-action\/coverage@a19242102d17e497f437d7466aa01b528537e899/
  );
  assert.doesNotMatch(codecovWorkflow, /qltysh\/qlty-action\/coverage@v2/);
  assert.match(codecovWorkflow, /files: coverage\/lcov\.info/);
  assert.match(codecovWorkflow, /oidc: true/);

  assert.match(aggregateWorkflow, /QLTY_ENFORCE/);
  assert.match(aggregateWorkflow, /--required-context "qlty check"/);
});
