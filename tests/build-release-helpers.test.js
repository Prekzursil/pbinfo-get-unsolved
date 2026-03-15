const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const {
  minifyScript,
  resolveLocalModulePath,
  makeModuleId,
  resolvePackageVersion,
  renderUserscriptTemplate,
  bundleBrowserEntry,
  main,
} = require('../scripts/build-release.cjs');

test('build-release helpers: resolve paths, version fallback, and bundle local modules', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbinfo-build-release-'));
  const entryPath = path.join(tmpDir, 'entry.js');
  const depPath = path.join(tmpDir, 'dep.js');

  fs.writeFileSync(depPath, 'module.exports = "dep";\n', 'utf8');
  fs.writeFileSync(entryPath, 'globalThis.__bundleResult = require("./dep");\n', 'utf8');

  assert.equal(resolveLocalModulePath(entryPath, './dep'), depPath);
  assert.equal(resolveLocalModulePath(entryPath, './dep.js'), depPath);
  assert.equal(makeModuleId(tmpDir, depPath), 'dep.js');
  assert.equal(resolvePackageVersion({ version: '1.2.3' }), '1.2.3');
  assert.equal(resolvePackageVersion({ version: '' }), '0.0.0');
  assert.equal(resolvePackageVersion({ version: 42 }), '0.0.0');

  const bundle = await bundleBrowserEntry(tmpDir, entryPath);
  const context = { globalThis: {} };
  vm.runInNewContext(bundle, context);

  assert.match(bundle, /__bundleResult/);
  assert.equal(context.globalThis.__bundleResult, 'dep');
  assert.doesNotMatch(bundle, /\brequire\(/);
});

test('build-release helpers: minify error path and main failure path', async () => {
  await assert.rejects(
    bundleBrowserEntry(__dirname, 'entry.js', async () => ({ outputFiles: null })),
    /esbuild did not return bundled code/
  );
  await assert.rejects(
    bundleBrowserEntry(__dirname, 'entry.js', async () => ({ outputFiles: [] })),
    /esbuild did not return bundled code/
  );
  await assert.rejects(
    minifyScript('console.log(1);', async function () {
      return null;
    }),
    /Terser did not return minified code/
  );
  await assert.rejects(
    minifyScript('console.log(1);', async () => ({ code: '' })),
    /Terser did not return minified code/
  );

  const originalExitCode = process.exitCode;
  const errors = [];

  process.exitCode = undefined;
  await main(
    function () {
      throw new Error('expected-build-failure');
    },
    function (error) {
      errors.push(error.message);
    }
  );

  assert.deepEqual(errors, ['expected-build-failure']);
  assert.equal(process.exitCode, 1);
  process.exitCode = originalExitCode;
});

test('build-release helpers: userscript template placeholder is required', () => {
  assert.equal(
    renderUserscriptTemplate('prefix /* __PBINFO_CORE_CODE__ */ suffix', 'MINIFIED', 'template.js'),
    'prefix MINIFIED suffix'
  );
  assert.throws(
    () => renderUserscriptTemplate('prefix suffix', 'MINIFIED', 'template.js'),
    /Userscript template is missing placeholder/
  );
});
