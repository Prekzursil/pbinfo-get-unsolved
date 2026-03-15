const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const expectedGeneratedExclusions = new Set([
  'coverage/**',
  'coverage-100/**',
  'dist/**',
  'node_modules/**',
  '.tmp*/**',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);
const forbiddenScopePatterns = ['tests/**', 'docs/**', 'scripts/**', '.github/workflows/**', 'src/**'];

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function parseCodacyExcludePaths(configText) {
  const lines = configText.split(/\r?\n/);
  const exclusions = [];
  let inExcludeSection = false;

  for (const line of lines) {
    if (!inExcludeSection) {
      if (/^exclude_paths:\s*$/.test(line.trim())) {
        inExcludeSection = true;
      }
      continue;
    }

    if (/^-\s+/.test(line.trim())) {
      exclusions.push(line.trim().replace(/^-+\s+/, ''));
      continue;
    }

    if (line.trim() !== '' && !line.startsWith(' ')) {
      break;
    }
  }

  return exclusions;
}

test('codacy repo config excludes only generated/build/cache artifacts', () => {
  const codacyPath = path.join(rootDir, '.codacy.yaml');
  assert.equal(fs.existsSync(codacyPath), true, '.codacy.yaml should exist');

  const codacyConfig = readRepoFile('.codacy.yaml');
  assert.match(codacyConfig, /^exclude_paths:/m);

  const exclusions = parseCodacyExcludePaths(codacyConfig);
  assert.deepEqual(
    new Set(exclusions),
    expectedGeneratedExclusions,
    'Codacy exclusions must stay limited to generated/build/cache artifacts.'
  );

  for (const forbiddenPattern of forbiddenScopePatterns) {
    assert.ok(
      !exclusions.includes(forbiddenPattern),
      `Codacy exclusions must keep ${forbiddenPattern} in analysis scope.`
    );
  }
});
