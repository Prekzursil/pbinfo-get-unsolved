const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('codacy repo config excludes non-product paths that vendor defaults misclassify', () => {
  const codacyPath = path.join(rootDir, '.codacy.yaml');
  assert.equal(fs.existsSync(codacyPath), true, '.codacy.yaml should exist');

  const codacyConfig = readRepoFile('.codacy.yaml');
  assert.match(codacyConfig, /^exclude_paths:/m);
  assert.match(codacyConfig, /- coverage\/\*\*/);
  assert.match(codacyConfig, /- coverage-100\/\*\*/);
  assert.match(codacyConfig, /- dist\/\*\*/);
  assert.match(codacyConfig, /- package-lock\.json/);
  assert.doesNotMatch(codacyConfig, /- tests\/\*\*/);
  assert.doesNotMatch(codacyConfig, /- tests\/fixtures\/\*\*/);
  assert.doesNotMatch(codacyConfig, /- docs\/\*\*/);
  assert.doesNotMatch(codacyConfig, /- scripts\/\*\*/);
  assert.doesNotMatch(codacyConfig, /- \.github\/workflows\/\*\*/);
});
