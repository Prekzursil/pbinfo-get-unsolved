const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  runInlinePythonProbe: runInlinePythonFromFile,
  runQualityPythonScript,
} = require('./python-command');

const rootDir = path.join(__dirname, '..');

function runRepoPython(scriptRelativePath, scriptArgs = [], options = {}) {
  return runQualityPythonScript(rootDir, scriptRelativePath, scriptArgs, options);
}

function runPythonProbe(source, options = {}) {
  return runInlinePythonFromFile(rootDir, source, options);
}

const CLOSE_RESPONSES_PROBE = `
import importlib.util
import json
import pathlib

module_path = pathlib.Path("scripts/security_helpers.py").resolve()
spec = importlib.util.spec_from_file_location("security_helpers", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

closed = {"value": False}

class FakeResponse:
    status = 200
    reason = "OK"
    headers = {"X-Test": "1"}

    def read(self):
        return b'{"ok": true}'

    def close(self):
        closed["value"] = True

def fake_urlopen(request_obj, timeout=0, context=None):
    print(request_obj.full_url)
    print(request_obj.get_method())
    print(timeout)
    print(context is not None)
    return FakeResponse()

module.urllib_request.urlopen = fake_urlopen
payload, headers = module.request_json_with_headers(
    "https://api.github.com/repos/example/repo",
    method="POST",
    data={"hello": "world"},
    timeout=7,
    allowed_hosts={"api.github.com"},
)
print(json.dumps({"payload": payload, "headers": headers, "closed": closed["value"]}))
`;

const SECURE_DEFAULT_HTTPS_PROBE = `
import importlib.util
import json
import pathlib

module_path = pathlib.Path("scripts/security_helpers.py").resolve()
spec = importlib.util.spec_from_file_location("security_helpers", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

captured = {}

class FakeResponse:
    status = 200
    reason = "OK"
    headers = {}

    def read(self):
        return b'{"ok": true}'

    def close(self):
        pass

def fake_urlopen(request_obj, timeout=0, context=None):
    captured["context"] = context
    return FakeResponse()

module.urllib_request.urlopen = fake_urlopen
module.request_json_with_headers(
    "https://api.github.com/repos/example/repo",
    allowed_hosts={"api.github.com"},
)
result = {
    "context_is_none": captured["context"] is None,
}
print(json.dumps(result))
`;

const NORMALIZE_HTTP_ERRORS_PROBE = `
import importlib.util
import json
import pathlib
from urllib import error as urllib_error

module_path = pathlib.Path("scripts/security_helpers.py").resolve()
spec = importlib.util.spec_from_file_location("security_helpers", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

closed = {"value": False}

class FakeStream:
    def read(self):
        return b'{"message":"blocked"}'

    def close(self):
        closed["value"] = True

def fake_urlopen(request_obj, timeout=0, context=None):
    raise urllib_error.HTTPError(
        request_obj.full_url,
        403,
        "Forbidden",
        {"content-type": "application/json"},
        FakeStream(),
    )

module.urllib_request.urlopen = fake_urlopen
try:
    module.request_json_with_headers(
        "https://api.github.com/repos/example/repo",
        allowed_hosts={"api.github.com"},
    )
except module.HttpsStatusError as exc:
    print(
        json.dumps(
            {
                "status_code": exc.status_code,
                "reason": exc.reason,
                "body": exc.body,
                "closed": closed["value"],
            }
        )
    )
else:
    print(json.dumps({"missing_error": True}))
`;

function splitOutputLines(stdout) {
  return stdout.trim().split(/\r?\n/u);
}

function parseLastJsonLine(lines) {
  return JSON.parse(lines[lines.length - 1]);
}

function removeDirectoryIfEmpty(directoryPath) {
  try {
    fs.rmdirSync(directoryPath);
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : '';
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY') {
      throw error;
    }
  }
}

function createCodacyArtifactPaths(t) {
  const tempRoot = path.join(rootDir, '.tmp-test-artifacts');
  fs.mkdirSync(tempRoot, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(tempRoot, 'codacy-zero-'));
  const outJson = path.join(tempDir, 'codacy.json');
  const outMd = path.join(tempDir, 'codacy.md');

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    removeDirectoryIfEmpty(tempRoot);
  });

  return { outJson, outMd };
}

function testRequiredChecksHelpFromRepoRoot() {
  const result = runRepoPython('scripts/quality/check_required_checks.py', ['--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Wait for required GitHub check contexts/);
}

test(
  'python quality scripts: required-checks help loads from repo root',
  testRequiredChecksHelpFromRepoRoot
);

function testCodacyGateWithoutToken(t) {
  const { outJson, outMd } = createCodacyArtifactPaths(t);
  const result = runRepoPython(
    'scripts/quality/check_codacy_zero.py',
    [
      '--owner',
      'Prekzursil',
      '--repo',
      'pbinfo-get-unsolved',
      '--out-json',
      outJson,
      '--out-md',
      outMd,
    ],
    {
      env: {
        CODACY_API_TOKEN: '',
      },
    }
  );

  assert.equal(result.status, 1, result.stderr);
  assert.equal(fs.existsSync(outJson), true);
  assert.equal(fs.existsSync(outMd), true);

  const payload = JSON.parse(fs.readFileSync(outJson, 'utf8'));
  const markdown = fs.readFileSync(outMd, 'utf8');
  assert.equal(payload.status, 'fail');
  assert.match(payload.findings[0], /CODACY_API_TOKEN is missing/);
  assert.match(markdown, /CODACY_API_TOKEN is missing\./);
}

test(
  'python quality scripts: codacy gate degrades cleanly when token is missing',
  testCodacyGateWithoutToken
);

function testPythonSecurityHelperClosesResponses() {
  const result = runPythonProbe(CLOSE_RESPONSES_PROBE);

  assert.equal(result.status, 0, result.stderr);
  const lines = splitOutputLines(result.stdout);
  assert.match(lines[0], /^https:\/\/api\.github\.com\/repos\/example\/repo$/u);
  assert.equal(lines[1], 'POST');
  assert.equal(lines[2], '7');
  assert.equal(lines[3], 'False');
  const payload = parseLastJsonLine(lines);
  assert.deepEqual(payload.payload, { ok: true });
  assert.deepEqual(payload.headers, { 'x-test': '1' });
  assert.equal(payload.closed, true);
}

test(
  'python security helper: request_json_with_headers closes responses without HTTPSConnection',
  testPythonSecurityHelperClosesResponses
);

function testPythonSecurityHelperUsesSecureDefaultHttpsHandling() {
  const result = runPythonProbe(SECURE_DEFAULT_HTTPS_PROBE);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.context_is_none, true);
}

test(
  'python security helper: request_json_with_headers relies on secure default HTTPS handling',
  testPythonSecurityHelperUsesSecureDefaultHttpsHandling
);

function testPythonSecurityHelperNormalizesHttpErrors() {
  const result = runPythonProbe(NORMALIZE_HTTP_ERRORS_PROBE);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status_code, 403);
  assert.equal(payload.reason, 'Forbidden');
  assert.equal(payload.body, '{"message":"blocked"}');
  assert.equal(payload.closed, true);
  assert.equal(payload.missing_error, undefined);
}

test(
  'python security helper: request_json_with_headers normalizes HTTP errors',
  testPythonSecurityHelperNormalizesHttpErrors
);

function testSentryZeroSupportsProjectIssuesFallback() {
  const source = fs.readFileSync(
    path.join(rootDir, 'scripts/quality/check_sentry_zero.py'),
    'utf8'
  );

  assert.equal(source.includes('organizations/{org_slug}/projects/'), true);
  assert.equal(source.includes('organizations/{org_slug}/issues/?'), true);
  assert.equal(source.includes('projects/{org_slug}/{safe_project_slug}/issues/'), true);
}

test(
  'python quality scripts: sentry zero supports project issues fallback when org project discovery fails',
  testSentryZeroSupportsProjectIssuesFallback
);
