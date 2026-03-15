const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('codacy zero gate supports pull request full-tree enforcement instead of repo backlog totals', () => {
  const script = readRepoFile('scripts/quality/check_codacy_zero.py');
  const workflow = readRepoFile('.github/workflows/codacy-zero.yml');

  assert.match(script, /--branch/);
  assert.match(script, /--expected-sha/);
  assert.match(script, /selectedBranch/);
  assert.match(script, /lastAnalysedCommit/);
  assert.match(script, /issuesCount/);
  assert.match(workflow, /QUALITY_BRANCH:/);
  assert.match(workflow, /EXPECTED_ANALYSIS_SHA:/);
  assert.match(workflow, /github\.head_ref/);
  assert.match(workflow, /github\.event\.pull_request\.head\.sha/);
  assert.match(workflow, /--branch "\$\{QUALITY_BRANCH\}"/);
  assert.match(workflow, /--expected-sha "\$\{EXPECTED_ANALYSIS_SHA\}"/);
});
