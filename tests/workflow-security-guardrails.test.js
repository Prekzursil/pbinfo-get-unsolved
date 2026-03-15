const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

const WORKFLOW_PATHS = {
  codacy: '.github/workflows/codacy-zero.yml',
  qualityGate: '.github/workflows/quality-zero-gate.yml',
  ci: '.github/workflows/ci.yml',
  coverage: '.github/workflows/coverage-100.yml',
  deepscan: '.github/workflows/deepscan-zero.yml',
  sentry: '.github/workflows/sentry-zero.yml',
  codecov: '.github/workflows/codecov-analytics.yml',
  release: '.github/workflows/release.yml',
  sonar: '.github/workflows/sonar-zero.yml',
};

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function readWorkflowFiles() {
  return Object.fromEntries(
    Object.entries(WORKFLOW_PATHS).map(([key, workflowPath]) => [key, readRepoFile(workflowPath)])
  );
}

function assertPinnedRefs(workflowText, refs) {
  refs.forEach((refPattern) => {
    assert.match(workflowText, refPattern);
  });
}

test('workflow security guardrails pin refs for scanner and gate workflows', () => {
  const workflows = readWorkflowFiles();

  assertPinnedRefs(workflows.codacy, [
    /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd/,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  ]);
  assertPinnedRefs(workflows.qualityGate, [
    /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd/,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  ]);
  assertPinnedRefs(workflows.coverage, [
    /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd/,
    /actions\/setup-python@a309ff8b426b58ec0e2a45f0f869d46889d02405/,
    /actions\/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f/,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  ]);
  assertPinnedRefs(workflows.deepscan, [
    /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd/,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  ]);
  assertPinnedRefs(workflows.sentry, [
    /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd/,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  ]);
  assertPinnedRefs(workflows.sonar, [
    /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd/,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  ]);
});

test('workflow security guardrails pin refs for ci/release workflow lanes', () => {
  const workflows = readWorkflowFiles();

  assertPinnedRefs(workflows.ci, [
    /actions\/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5/,
    /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/,
  ]);
  assertPinnedRefs(workflows.release, [
    /actions\/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5/,
    /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/,
  ]);
  assert.match(workflows.release, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflows.release, /gh release create/);
  assert.match(workflows.release, /gh release upload/);
  assert.doesNotMatch(workflows.release, /softprops\/action-gh-release/);
});

test('workflow security guardrails pin refs for codecov/codacy reporting lane', () => {
  const workflows = readWorkflowFiles();

  assertPinnedRefs(workflows.codecov, [
    /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd/,
    /actions\/setup-python@a309ff8b426b58ec0e2a45f0f869d46889d02405/,
    /actions\/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f/,
    /codecov\/codecov-action@671740ac38dd9b0130fbe1cec585b89eea48d3de/,
    /codacy\/codacy-coverage-reporter-action@89d6c85cfafaec52c72b6c5e8b2878d33104c699/,
  ]);
});

test('workflow security guardrails keep upload steps from including hidden files', () => {
  const workflows = readWorkflowFiles();

  [
    workflows.codacy,
    workflows.qualityGate,
    workflows.coverage,
    workflows.deepscan,
    workflows.sentry,
    workflows.sonar,
  ].forEach((workflowText) => {
    assert.match(workflowText, /include-hidden-files: false/);
  });
});

test('workflow security guardrails keep shell interpolation hardening for sonar and quality gates', () => {
  const workflows = readWorkflowFiles();

  assert.doesNotMatch(workflows.ci, /cache: npm/);
  assert.doesNotMatch(workflows.qualityGate, /\$\{\{ needs\.secrets-preflight\.result \}\}/);
  assert.match(workflows.sonar, /SONAR_PULL_REQUEST:/);
  assert.match(workflows.sonar, /--pull-request "\$\{SONAR_PULL_REQUEST\}"/);
  assert.doesNotMatch(
    workflows.sonar,
    /--pull-request "\$\{\{ github\.event\.pull_request\.number \|\| '' \}\}"/
  );
});
