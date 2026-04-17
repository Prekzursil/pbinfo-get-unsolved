'use strict';

// Thin wrapper around `node --test` that tolerates CI-injected flags.
//
// The shared Quality Zero "Codecov Analytics" reusable workflow calls
// `npm test -- --coverage --watch=false`. Those flags are new in Node 22;
// Node 20 errors with `node: bad option: --coverage`. This wrapper
// normalizes:
//   - `--coverage`          → swallowed (we report coverage via c8 in
//                             `npm run test:coverage`)
//   - `--watch=false`       → swallowed (non-watch is already default)
//   - everything else       → forwarded to `node --test`
// so the same `npm test` invocation works on both Node 20 and Node 22+.

const { spawnSync } = require('node:child_process');

const IGNORED_ARGS = new Set(['--coverage', '--watch=false', '--watch', '--no-watch']);

const rawArgs = process.argv.slice(2);
const forwarded = rawArgs.filter((arg) => !IGNORED_ARGS.has(arg));

const result = spawnSync('node', ['--test', ...forwarded], {
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
