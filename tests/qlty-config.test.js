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
const forbiddenScopePatterns = [
  'tests/**',
  'docs/**',
  'scripts/**',
  '.github/workflows/**',
  'src/**',
];

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function parseQltyExcludePatterns(tomlText) {
  const match = tomlText.match(/exclude_patterns\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(match, 'exclude_patterns array should be declared in .qlty/qlty.toml');

  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

test('qlty excludes only generated/build/cache artifacts and keeps signal paths in scope', () => {
  const qltyToml = readRepoFile('.qlty/qlty.toml');

  assert.match(qltyToml, /^config_version = "0"$/m);
  assert.match(qltyToml, /\[\[source\]\]\s+name = "default"\s+default = true/s);
  assert.match(qltyToml, /\[smells\]\s+mode = "block"/s);
  assert.match(qltyToml, /\[\[plugin\]\]\s+name = "actionlint"\s+mode = "block"/s);
  assert.match(
    qltyToml,
    /\[\[plugin\]\]\s+name = "prettier"\s+version = "3\.4\.2"\s+mode = "block"/s
  );
  assert.match(qltyToml, /"tests\/\*\*\/\*\.test\.js"/);

  const exclusions = parseQltyExcludePatterns(qltyToml);
  assert.deepEqual(
    new Set(exclusions),
    expectedGeneratedExclusions,
    'Qlty exclusions must stay limited to generated/build/cache artifacts.'
  );

  for (const forbiddenPattern of forbiddenScopePatterns) {
    assert.ok(
      !exclusions.includes(forbiddenPattern),
      `Qlty exclusions must keep ${forbiddenPattern} in analysis scope.`
    );
  }
});
