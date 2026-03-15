const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('workflow security guardrails pin action refs and avoid risky shell interpolation', () => {
  const codacyWorkflow = readRepoFile('.github/workflows/codacy-zero.yml');
  const qualityGateWorkflow = readRepoFile('.github/workflows/quality-zero-gate.yml');
  const ciWorkflow = readRepoFile('.github/workflows/ci.yml');
  const coverageWorkflow = readRepoFile('.github/workflows/coverage-100.yml');
  const deepscanWorkflow = readRepoFile('.github/workflows/deepscan-zero.yml');
  const sentryWorkflow = readRepoFile('.github/workflows/sentry-zero.yml');
  const codecovWorkflow = readRepoFile('.github/workflows/codecov-analytics.yml');
  const releaseWorkflow = readRepoFile('.github/workflows/release.yml');
  const sonarWorkflow = readRepoFile('.github/workflows/sonar-zero.yml');

  assert.match(codacyWorkflow, /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd/);
  assert.match(codacyWorkflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(qualityGateWorkflow, /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd/);
  assert.match(
    qualityGateWorkflow,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/
  );
  assert.match(ciWorkflow, /actions\/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5/);
  assert.match(ciWorkflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(coverageWorkflow, /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd/);
  assert.match(coverageWorkflow, /actions\/setup-python@a309ff8b426b58ec0e2a45f0f869d46889d02405/);
  assert.match(coverageWorkflow, /actions\/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f/);
  assert.match(
    coverageWorkflow,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/
  );
  assert.match(deepscanWorkflow, /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd/);
  assert.match(
    deepscanWorkflow,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/
  );
  assert.match(sentryWorkflow, /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd/);
  assert.match(sentryWorkflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(codecovWorkflow, /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd/);
  assert.match(codecovWorkflow, /actions\/setup-python@a309ff8b426b58ec0e2a45f0f869d46889d02405/);
  assert.match(codecovWorkflow, /actions\/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f/);
  assert.match(codecovWorkflow, /codecov\/codecov-action@671740ac38dd9b0130fbe1cec585b89eea48d3de/);
  assert.match(
    codecovWorkflow,
    /codacy\/codacy-coverage-reporter-action@89d6c85cfafaec52c72b6c5e8b2878d33104c699/
  );
  assert.match(releaseWorkflow, /actions\/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5/);
  assert.match(releaseWorkflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(
    releaseWorkflow,
    /softprops\/action-gh-release@b25b93d384199fc0fc8c2e126b2d937a0cbeb2ae/
  );
  assert.match(sonarWorkflow, /actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd/);
  assert.match(sonarWorkflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);

  [
    codacyWorkflow,
    qualityGateWorkflow,
    coverageWorkflow,
    deepscanWorkflow,
    sentryWorkflow,
    sonarWorkflow,
  ].forEach((workflowText) => {
    assert.match(workflowText, /include-hidden-files: false/);
  });

  assert.doesNotMatch(ciWorkflow, /cache: npm/);
  assert.doesNotMatch(qualityGateWorkflow, /\$\{\{ needs\.secrets-preflight\.result \}\}/);
  assert.match(sonarWorkflow, /SONAR_PULL_REQUEST:/);
  assert.match(sonarWorkflow, /--pull-request "\$\{SONAR_PULL_REQUEST\}"/);
  assert.doesNotMatch(
    sonarWorkflow,
    /--pull-request "\$\{\{ github\.event\.pull_request\.number \|\| '' \}\}"/
  );
});
