const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  DEFAULT_PATTERNS,
  resolveLintPatterns,
  runLint,
  formatLintFailure,
  main,
} = require('../scripts/run-eslint.cjs');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function buildFixturePath(name) {
  return path.join(__dirname, name);
}

const EMPTY_FORMATTER = { format: () => '' };

test('lint pipeline uses the dedicated deterministic entrypoint', () => {
  const packageJsonText = readRepoFile('package.json');

  assert.match(packageJsonText, /"lint"\s*:\s*"[^"]*node scripts\/run-eslint\.cjs[^"]*"/);
  assert.doesNotMatch(packageJsonText, /"lint"\s*:\s*"[^"]*\beslint\s+\.[^"]*"/);
});

test('lint entrypoint completes successfully for the repository', () => {
  const rootDir = path.resolve(__dirname, '..');
  const output = execFileSync(process.execPath, ['scripts/run-eslint.cjs'], {
    cwd: rootDir,
    stdio: 'pipe',
  }).toString();

  assert.match(output, /ESLint totals: 0 error\(s\), 0 warning\(s\)/);
});

test('lint runner defaults to DEFAULT_PATTERNS when patterns are omitted', async () => {
  const result = await runLint();

  assert.equal(result.errorCount, 0, result.output);
  assert.equal(result.warningCount, 0, result.output);
  assert.equal(typeof result.output, 'string');
});

test('lint runner passes DEFAULT_PATTERNS to lintFiles when no patterns are provided', async () => {
  const calls = [];
  class FakeESLint {
    async lintFiles(patterns) {
      calls.push(patterns);
      return [];
    }

    async loadFormatter() {
      return EMPTY_FORMATTER;
    }
  }

  const result = await runLint(undefined, FakeESLint);
  assert.equal(result.errorCount, 0);
  assert.equal(result.warningCount, 0);
  assert.deepEqual(calls, [DEFAULT_PATTERNS]);
});

test('lint runner accepts explicit patterns when they are provided', async () => {
  const result = await runLint(['src/core/index.js']);

  assert.equal(result.errorCount, 0);
  assert.equal(result.warningCount, 0);
  assert.equal(typeof result.output, 'string');
});

test('resolveLintPatterns filters CLI flags and falls back to defaults when no file globs remain', () => {
  assert.deepEqual(resolveLintPatterns(['--fix', 'src/core/index.js']), ['src/core/index.js']);
  assert.deepEqual(resolveLintPatterns(['--fix', '--max-warnings=0']), DEFAULT_PATTERNS);
  assert.deepEqual(resolveLintPatterns([null, 42, '--fix']), DEFAULT_PATTERNS);
});

test('lint main writes formatter output and returns non-zero for lint findings', async () => {
  let stdout = '';
  let stderr = '';
  const exitCode = await main({
    runLintImpl: async () => ({
      output: buildFixturePath('example.js') + '\n  1:1  error  boom  no-unused-vars\n',
      errorCount: 1,
      warningCount: 0,
    }),
    argv: [],
    stdout: {
      write(chunk) {
        stdout += String(chunk);
      },
    },
    stderr: {
      write(chunk) {
        stderr += String(chunk);
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.match(stdout, /example\.js/);
  assert.match(stdout, /ESLint totals: 1 error\(s\), 0 warning\(s\)/);
  assert.equal(stderr, '');
});

test('lint main reports runner failures to stderr and returns non-zero', async () => {
  let stdout = '';
  let stderr = '';
  const exitCode = await main({
    runLintImpl: async () => {
      throw new Error('lint runner exploded');
    },
    argv: [],
    stdout: {
      write(chunk) {
        stdout += String(chunk);
      },
    },
    stderr: {
      write(chunk) {
        stderr += String(chunk);
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /lint runner exploded/);
});

test('lint main writes formatter output before the summary when present', async () => {
  const writes = [];
  const exitCode = await main({
    argv: DEFAULT_PATTERNS,
    runLintImpl: async () => ({
      output: buildFixturePath('example.js') + '\n  1:1  error  boom  no-undef\n',
      errorCount: 1,
      warningCount: 0,
    }),
    stdout: {
      write(chunk) {
        writes.push(chunk);
      },
    },
    stderr: {
      write() {},
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(writes, [
    buildFixturePath('example.js') + '\n  1:1  error  boom  no-undef\n',
    '\nESLint totals: 1 error(s), 0 warning(s)\n',
  ]);
});

test('lint main reports fatal execution errors to stderr', async () => {
  const writes = [];
  const exitCode = await main({
    argv: [],
    runLintImpl: async () => {
      throw new Error('fatal lint failure');
    },
    stdout: {
      write() {},
    },
    stderr: {
      write(chunk) {
        writes.push(chunk);
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.match(writes.join(''), /fatal lint failure/);
});

test('lint main stringifies non-Error failures without crashing', async () => {
  const writes = [];
  const plainFailure = { toString: () => 'plain failure' };
  const exitCode = await main({
    argv: [],
    runLintImpl: async () => {
      throw plainFailure;
    },
    stdout: {
      write() {},
    },
    stderr: {
      write(chunk) {
        writes.push(chunk);
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.match(writes.join(''), /plain failure/);
  assert.equal(formatLintFailure(plainFailure), 'plain failure');
});
