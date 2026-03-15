const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function isWorkflowStepBoundary(line) {
  return line.startsWith('        - name: ') || line.startsWith('      - name: ');
}

function isRunBlockContentLine(line) {
  return line === '' || line.startsWith('          ');
}

function extractNamedRunBlock(workflowText, stepName) {
  const lines = workflowText.split(/\r?\n/);
  const target = `- name: ${stepName}`;
  const startIndex = lines.findIndex((line) => line.trim() === target);

  if (startIndex === -1) {
    return null;
  }

  const runIndex = lines.findIndex(
    (line, index) => index > startIndex && line.startsWith('        run: |')
  );

  if (runIndex === -1) {
    return null;
  }

  const blockLines = [];
  for (let index = runIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (isWorkflowStepBoundary(line)) {
      break;
    }
    if (!isRunBlockContentLine(line)) {
      break;
    }
    blockLines.push(line);
  }

  return blockLines.length > 0 ? blockLines.join('\n') : null;
}

function countNonCommentLines(sourceText) {
  return sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//')).length;
}

test('static-analysis guardrails helper extracts workflow run blocks without nested backtracking regex', () => {
  const workflowText = [
    'jobs:',
    '  release:',
    '    steps:',
    '      - name: Resolve release tag',
    '        run: |',
    '          echo "hello"',
    '          echo "world"',
    '      - name: Next step',
    '        run: echo "done"',
  ].join('\n');

  assert.equal(
    extractNamedRunBlock(workflowText, 'Resolve release tag'),
    ['          echo "hello"', '          echo "world"'].join('\n')
  );
});

test('static-analysis guardrails: no known Semgrep-triggering patterns remain in maintained source', () => {
  const scoreParsing = readRepoFile('src/core/score-parsing.js');
  const runtime = readRepoFile('src/core/pbinfo-runtime.js');
  const runtimePageParsing = readRepoFile('src/core/runtime-page-parsing.js');
  const runtimeStorageSetup = readRepoFile('src/core/runtime-storage-setup.js');
  const network = readRepoFile('src/core/network.js');
  const runtimeStorage = readRepoFile('src/core/runtime-storage.js');
  const pythonQualityTests = readRepoFile('tests/python-quality-scripts.test.js');
  const qualitySecretsPreflight = readRepoFile('tests/quality-secrets-preflight.test.js');
  const buildRelease = readRepoFile('scripts/build-release.cjs');
  const securityHelpers = readRepoFile('scripts/security_helpers.py');
  const coreIndex = readRepoFile('src/core/index.js');
  const releaseWorkflow = readRepoFile('.github/workflows/release.yml');
  const qualityScripts = [
    'scripts/quality/check_codacy_zero.py',
    'scripts/quality/check_deepscan_zero.py',
    'scripts/quality/check_required_checks.py',
    'scripts/quality/check_sentry_zero.py',
    'scripts/quality/check_sonar_zero.py',
  ];

  assert.doesNotMatch(scoreParsing, /\.charCodeAt\(/);
  assert.doesNotMatch(scoreParsing, /\bnew RegExp\(/);
  assert.doesNotMatch(scoreParsing, /\/\w\/\.(?:test|exec)\(/);
  assert.doesNotMatch(runtime, /\.innerHTML\s*=/);
  assert.doesNotMatch(runtimePageParsing, /function createProblemRecord\(/);
  assert.doesNotMatch(runtimePageParsing, /\bbuildProblemRecord\(\{/);
  assert.doesNotMatch(runtimePageParsing, /\bbuildProblemRecord\(\s*buildProblemRecordInput\(\{/);
  assert.doesNotMatch(runtimePageParsing, /\bbuildProblemRecordInput\(/);
  assert.doesNotMatch(runtimeStorageSetup, /function updateSetupWizardView\(\s*\{/);
  assert.ok(
    countNonCommentLines(runtimeStorageSetup) <= 500,
    'runtime-storage-setup.js should stay below Codacy Lizard medium NLOC threshold'
  );
  assert.doesNotMatch(runtime, /console\.warn\(`Failed to save/);
  assert.doesNotMatch(network, /catch \(error\) \{\s*void error;\s*return null;/);
  assert.doesNotMatch(runtimeStorage, /catch \(error\) \{\s*void error;/);
  assert.doesNotMatch(pythonQualityTests, /process\.env\.PYTHON/);
  assert.doesNotMatch(pythonQualityTests, /spawnSync\(candidate\.command/);
  assert.doesNotMatch(pythonQualityTests, /\[\s*'-c'\s*,\s*source\s*\]/);
  assert.doesNotMatch(qualitySecretsPreflight, /process\.env\.PYTHON/);
  assert.doesNotMatch(qualitySecretsPreflight, /spawnSync\(candidate\.command/);
  assert.match(buildRelease, /require\('esbuild'\)/);
  assert.doesNotMatch(buildRelease, /return `\(function\(\)\{const __modules=\{/);
  assert.doesNotMatch(securityHelpers, /\bHTTPSConnection\s*\(/);
  assert.doesNotMatch(releaseWorkflow, /workflow_dispatch:[ \t]*\r?\n[ \t]+inputs:/);
  assert.doesNotMatch(releaseWorkflow, /\bResolve release tag\b/);
  assert.match(releaseWorkflow, /tag="\$\{GITHUB_REF_NAME\}"/);
  assert.doesNotMatch(releaseWorkflow, /RELEASE_EVENT_NAME/);
  assert.doesNotMatch(releaseWorkflow, /RELEASE_INPUT_TAG/);
  assert.match(coreIndex, /require\('\.\/progress'\)/);

  qualityScripts.forEach((relativePath) => {
    assert.doesNotMatch(readRepoFile(relativePath), /urllib\.request\.urlopen\(/, relativePath);
  });
});
