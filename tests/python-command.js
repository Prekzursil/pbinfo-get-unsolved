const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WINDOWS_PYTHON_KIND = 'windows-py-3';
const PYTHON3_KIND = 'python3';
const PYTHON_KIND = 'python';
const PYTHON_KINDS = Object.freeze(
  process.platform === 'win32'
    ? [WINDOWS_PYTHON_KIND, PYTHON3_KIND, PYTHON_KIND]
    : [PYTHON3_KIND, PYTHON_KIND]
);

function spawnPythonKind(kind, extraArgs, options = {}) {
  switch (kind) {
    case WINDOWS_PYTHON_KIND:
      return spawnSync('py', ['-3', ...extraArgs], { shell: false, windowsHide: true, ...options });
    case PYTHON3_KIND:
      return spawnSync('python3', extraArgs, { shell: false, windowsHide: true, ...options });
    case PYTHON_KIND:
      return spawnSync('python', extraArgs, { shell: false, windowsHide: true, ...options });
    default:
      throw new Error(`Unsupported python kind: ${kind}`);
  }
}

function resolvePythonKind() {
  for (const kind of PYTHON_KINDS) {
    const probe = spawnPythonKind(kind, ['--version'], {
      encoding: 'utf8',
    });
    if (probe.status === 0) {
      return kind;
    }
  }

  throw new Error('python interpreter not found in fixed PATH candidates');
}

function buildSpawnOptions(rootDir, options = {}) {
  const extraEnv = options.env && typeof options.env === 'object' ? options.env : undefined;
  return {
    cwd: rootDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      ...extraEnv,
    },
    shell: false,
    windowsHide: true,
    ...options,
  };
}

function runPythonArgs(rootDir, extraArgs, options = {}) {
  const pythonKind = resolvePythonKind();
  return spawnPythonKind(pythonKind, extraArgs, buildSpawnOptions(rootDir, options));
}

function runQualityPythonScript(rootDir, scriptRelativePath, scriptArgs = [], options = {}) {
  assert.match(scriptRelativePath, /^scripts\/quality\/[a-z0-9_-]+\.py$/u);
  return runPythonArgs(rootDir, [scriptRelativePath, ...scriptArgs], options);
}

function runInlinePythonProbe(rootDir, source, options = {}) {
  const probeRoot = path.join(rootDir, '.tmp-test-artifacts');
  fs.mkdirSync(probeRoot, { recursive: true });
  const probeDir = fs.mkdtempSync(path.join(probeRoot, 'python-probe-'));
  const probePath = path.join(probeDir, 'probe.py');
  fs.writeFileSync(probePath, source, 'utf8');

  let result;
  let thrownError = null;

  try {
    result = runPythonArgs(rootDir, [probePath], options);
  } catch (error) {
    thrownError = error;
  }

  fs.rmSync(probeDir, { recursive: true, force: true });
  try {
    fs.rmdirSync(probeRoot);
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : '';
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY') {
      thrownError = error;
    }
  }

  if (thrownError) {
    throw thrownError;
  }

  return result;
}

module.exports = {
  runInlinePythonProbe,
  runQualityPythonScript,
  resolvePythonKind,
};
