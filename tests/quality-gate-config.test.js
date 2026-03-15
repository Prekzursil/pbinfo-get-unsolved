const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

test('sonar zero gate uses checked-in project metadata without launching a duplicate scan', () => {
  const sonarConfigPath = path.join(rootDir, 'sonar-project.properties');
  assert.equal(fs.existsSync(sonarConfigPath), true, 'sonar-project.properties should exist');

  const sonarConfig = fs.readFileSync(sonarConfigPath, 'utf8');
  assert.match(sonarConfig, /^sonar\.projectKey=Prekzursil_pbinfo-get-unsolved$/m);
  assert.match(sonarConfig, /^sonar\.organization=prekzursil$/m);

  const sonarWorkflow = fs.readFileSync(
    path.join(rootDir, '.github/workflows/sonar-zero.yml'),
    'utf8'
  );
  assert.doesNotMatch(sonarWorkflow, /sonarqube-scan-action/);
  assert.match(sonarWorkflow, /check_sonar_zero\.py/);
  assert.match(sonarWorkflow, /--project-key "Prekzursil_pbinfo-get-unsolved"/);
  assert.match(sonarWorkflow, /SONAR_PULL_REQUEST:/);
  assert.match(sonarWorkflow, /--pull-request "\$\{SONAR_PULL_REQUEST\}"/);
});

test('required-context workflows resolve PR head SHA instead of the synthetic merge SHA', () => {
  const deepscanWorkflow = fs.readFileSync(
    path.join(rootDir, '.github/workflows/deepscan-zero.yml'),
    'utf8'
  );
  const aggregateWorkflow = fs.readFileSync(
    path.join(rootDir, '.github/workflows/quality-zero-gate.yml'),
    'utf8'
  );

  assert.match(deepscanWorkflow, /github\.event\.pull_request\.head\.sha/);
  assert.match(deepscanWorkflow, /--sha "\$\{QUALITY_CHECK_SHA\}"/);
  assert.match(aggregateWorkflow, /github\.event\.pull_request\.head\.sha/);
  assert.match(aggregateWorkflow, /--sha "\$\{QUALITY_CHECK_SHA\}"/);
});
