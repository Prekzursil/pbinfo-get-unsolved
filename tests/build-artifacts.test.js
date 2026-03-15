const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('build-release emits userscript, bookmarklet, and extension artifacts from shared source', () => {
  const rootDir = path.resolve(__dirname, '..');
  execFileSync(process.execPath, ['scripts/build-release.cjs'], {
    cwd: rootDir,
    stdio: 'pipe',
  });

  const expectedFiles = [
    'dist/pbinfo-get-unsolved.min.js',
    'dist/pbinfo-get-unsolved.userscript.js',
    'dist/pbinfo-get-unsolved.bookmarklet.txt',
    'dist/extension/chromium/content.js',
    'dist/extension/chromium/extension-bridge.js',
    'dist/extension/chromium/manifest.json',
    'dist/extension/chromium/options.html',
    'dist/extension/chromium/options.js',
    'dist/extension/chromium/pbinfo-core.js',
    'dist/extension/chromium/popup.html',
    'dist/extension/chromium/popup.js',
    'dist/extension/firefox/content.js',
    'dist/extension/firefox/extension-bridge.js',
    'dist/extension/firefox/manifest.json',
    'dist/extension/firefox/options.html',
    'dist/extension/firefox/options.js',
    'dist/extension/firefox/pbinfo-core.js',
    'dist/extension/firefox/popup.html',
    'dist/extension/firefox/popup.js',
  ];

  for (const relativePath of expectedFiles) {
    assert.equal(fs.existsSync(path.join(rootDir, relativePath)), true, relativePath);
  }

  const chromiumManifest = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'dist/extension/chromium/manifest.json'), 'utf8')
  );
  const firefoxManifest = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'dist/extension/firefox/manifest.json'), 'utf8')
  );

  assert.equal(chromiumManifest.manifest_version, 3);
  assert.equal(chromiumManifest.action.default_popup, 'popup.html');
  assert.equal(chromiumManifest.options_ui.page, 'options.html');
  assert.equal(
    firefoxManifest.browser_specific_settings.gecko.id,
    'pbinfo-get-unsolved@example.com'
  );
  assert.equal(
    fs.existsSync(path.join(rootDir, 'pbinfo-get-unsolved-enhanced.js')),
    false,
    'root runtime should not be a tracked/generated source artifact anymore'
  );
  assert.doesNotMatch(
    fs.readFileSync(path.join(rootDir, 'dist/pbinfo-get-unsolved.userscript.js'), 'utf8'),
    /pbinfo-get-unsolved-enhanced\.js/,
    'generated userscript should not reference the deleted root runtime filename'
  );
  assert.doesNotMatch(
    fs.readFileSync(path.join(rootDir, 'dist/extension/chromium/content.js'), 'utf8'),
    /\brequire\(/,
    'generated extension shell should be bundled and require-free'
  );
  assert.doesNotMatch(
    fs.readFileSync(path.join(rootDir, 'dist/extension/firefox/popup.js'), 'utf8'),
    /\brequire\(/,
    'generated extension popup should be bundled and require-free'
  );
});
