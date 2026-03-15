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
  assert.match(codacyConfig, /- tests\/\*\*/);
  assert.match(codacyConfig, /- tests\/fixtures\/\*\*/);
  assert.match(codacyConfig, /- coverage\/\*\*/);
  assert.match(codacyConfig, /- coverage-100\/\*\*/);
  assert.match(codacyConfig, /- dist\/\*\*/);
  assert.match(codacyConfig, /- docs\/\*\*/);
  assert.match(codacyConfig, /- \.github\/workflows\/\*\*/);
  assert.match(codacyConfig, /- package-lock\.json/);
});
