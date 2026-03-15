#!/usr/bin/env node

const { ESLint } = require('eslint');

const DEFAULT_PATTERNS = [
  'src/**/*.js',
  'tests/**/*.js',
  'scripts/**/*.js',
  'scripts/**/*.cjs',
  'eslint.config.cjs',
];

function resolveLintPatterns(patterns) {
  if (!Array.isArray(patterns)) {
    return DEFAULT_PATTERNS;
  }

  const lintPatterns = patterns.filter(function (pattern) {
    if (typeof pattern !== 'string') {
      return false;
    }
    const normalized = pattern.trim();
    return normalized.length > 0 && !normalized.startsWith('-');
  });

  return lintPatterns.length > 0 ? lintPatterns : DEFAULT_PATTERNS;
}

async function runLint(patterns, ESLintClass = ESLint) {
  const eslint = new ESLintClass({ errorOnUnmatchedPattern: false });
  const lintPatterns = resolveLintPatterns(patterns);
  const results = await eslint.lintFiles(lintPatterns);
  const formatter = await eslint.loadFormatter('stylish');
  const output = formatter.format(results);
  const errorCount = results.reduce(function (sum, result) {
    return sum + result.errorCount;
  }, 0);
  const warningCount = results.reduce(function (sum, result) {
    return sum + result.warningCount;
  }, 0);

  return {
    output,
    errorCount,
    warningCount,
  };
}

function formatLintFailure(error) {
  return error?.stack || String(error);
}

async function main(options) {
  const current = options && typeof options === 'object' ? options : {};
  const argv = Array.isArray(current.argv) ? current.argv : process.argv.slice(2);
  const runLintImpl = typeof current.runLintImpl === 'function' ? current.runLintImpl : runLint;
  const stdout =
    current.stdout && typeof current.stdout.write === 'function' ? current.stdout : process.stdout;
  const stderr =
    current.stderr && typeof current.stderr.write === 'function' ? current.stderr : process.stderr;
  let result;

  try {
    result = await runLintImpl(argv);
  } catch (error) {
    stderr.write(formatLintFailure(error) + '\n');
    return 1;
  }

  if (result.output) {
    stdout.write(result.output);
  }
  stdout.write(
    '\nESLint totals: ' + result.errorCount + ' error(s), ' + result.warningCount + ' warning(s)\n'
  );
  return result.errorCount === 0 ? 0 : 1;
}

if (require.main === module) {
  main().then(function (exitCode) {
    process.exitCode = exitCode;
  });
}

module.exports = {
  DEFAULT_PATTERNS,
  resolveLintPatterns,
  runLint,
  formatLintFailure,
  main,
};
