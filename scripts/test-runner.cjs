'use strict';

// Thin wrapper around `node --test` that tolerates CI-injected flags.
//
// The shared Quality Zero coverage gate invokes the profile coverage
// command `npm test -- --coverage --watch=false`. Those flags are new in
// Node 22; Node 20 errors with `node: bad option: --coverage`, and even on
// Node 22 the built-in `--coverage` reporter does not emit the lcov file
// the gate consumes. This wrapper normalizes:
//   - `--coverage`    -> route through c8 so `coverage/lcov.info` is written
//   - `--watch=false` -> swallowed (non-watch is already the default)
//   - everything else -> forwarded to `node --test`
// so the same `npm test` invocation works on both Node 20 and Node 22+ and
// produces the lcov report the gate asserts against.

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const COVERAGE_ARGS = new Set(['--coverage']);
const IGNORED_ARGS = new Set(['--watch=false', '--watch', '--no-watch']);

const rawArgs = process.argv.slice(2);
const wantCoverage = rawArgs.some((arg) => COVERAGE_ARGS.has(arg));
const forwarded = rawArgs.filter((arg) => !COVERAGE_ARGS.has(arg) && !IGNORED_ARGS.has(arg));

// Use the absolute path of the current Node binary instead of resolving
// "node" through PATH, so a poisoned PATH cannot redirect us to another
// executable.
const nodeBinary = process.execPath;

function runPlainTests() {
  return spawnSync(nodeBinary, ['--test', ...forwarded], {
    stdio: 'inherit',
    shell: false,
  });
}

function runCoverageTests() {
  const c8Bin = path.resolve(__dirname, '..', 'node_modules', 'c8', 'bin', 'c8.js');
  return spawnSync(
    nodeBinary,
    [
      c8Bin,
      '--config',
      path.resolve(__dirname, '..', '.c8rc.json'),
      nodeBinary,
      '--test',
      ...forwarded,
    ],
    {
      stdio: 'inherit',
      shell: false,
    }
  );
}

const result = wantCoverage ? runCoverageTests() : runPlainTests();

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
