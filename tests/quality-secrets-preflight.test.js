const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { runQualityPythonScript } = require('./python-command');

test('quality secrets preflight passes when the repo quality providers are configured', () => {
  const rootDir = path.resolve(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(rootDir, '.tmp-quality-secrets-'));
  const jsonPath = path.join(tempDir, 'secrets.json');
  const mdPath = path.join(tempDir, 'secrets.md');
  let result;

  try {
    result = runQualityPythonScript(
      rootDir,
      'scripts/quality/check_quality_secrets.py',
      ['--out-json', jsonPath, '--out-md', mdPath],
      {
        env: {
          SONAR_TOKEN: 'sonar-token',
          CODACY_API_TOKEN: 'codacy-token',
          SENTRY_AUTH_TOKEN: 'sentry-token',
          SENTRY_ORG: 'prekzursil',
          SENTRY_PROJECT: 'pbinfo-get-unsolved',
          APPLITOOLS_API_KEY: '',
        },
      }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(jsonPath), true);
    assert.equal(fs.existsSync(mdPath), true);
    assert.doesNotMatch(fs.readFileSync(mdPath, 'utf8'), /APPLITOOLS_API_KEY/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
