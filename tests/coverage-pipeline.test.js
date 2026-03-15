const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('coverage pipeline uses a shared test:coverage entrypoint and lcov artifact', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  const coverageWorkflow = readRepoFile('.github/workflows/coverage-100.yml');
  const codecovWorkflow = readRepoFile('.github/workflows/codecov-analytics.yml');

  assert.equal(typeof packageJson.scripts['test:coverage'], 'string');
  assert.match(packageJson.scripts['test:coverage'], /\bc8\b/);
  assert.match(packageJson.scripts['test:coverage'], /\bnode --test\b/);

  assert.match(coverageWorkflow, /\bnpm run test:coverage\b/);
  assert.match(codecovWorkflow, /\bnpm run test:coverage\b/);

  assert.doesNotMatch(coverageWorkflow, /--coverage/);
  assert.doesNotMatch(codecovWorkflow, /--coverage/);

  assert.match(coverageWorkflow, /coverage\/lcov\.info/);
  assert.match(codecovWorkflow, /coverage\/lcov\.info/);
});
