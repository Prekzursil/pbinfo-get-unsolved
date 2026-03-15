const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SHELL_FILES = [
  'src/shell-extension/shared.js',
  'src/shell-extension/content/content.js',
  'src/shell-extension/content/extension-bridge.js',
  'src/shell-extension/options/options.js',
  'src/shell-extension/popup/popup.js',
  'src/shell-userscript/bootstrap.js',
];

const MODERN_EXPECTATIONS = [{ name: 'block-scoped declarations', pattern: /\b(?:const|let)\b/ }];

const DISALLOWED_PATTERNS = [
  { name: 'async syntax', pattern: /(?:^|[^.\w$])async\s+(?:function|\()/m },
  { name: 'await keyword', pattern: /\bawait\b/ },
  { name: 'class syntax', pattern: /\bclass\s+\w/ },
  { name: 'window global access', pattern: /\bwindow\b/ },
  { name: 'typeof checks', pattern: /\btypeof\b/ },
  { name: 'bare parseInt', pattern: /(^|[^\w$.])parseInt\s*\(/ },
  { name: 'bare isFinite', pattern: /(^|[^\w$.])isFinite\s*\(/ },
];

test('owned shell source stays thin and modernized', function () {
  let index;
  let filePath;
  let source;
  let patternIndex;
  let entry;

  for (index = 0; index < SHELL_FILES.length; index += 1) {
    filePath = SHELL_FILES[index];
    source = fs.readFileSync(path.join(ROOT_DIR, filePath), 'utf8');

    for (patternIndex = 0; patternIndex < MODERN_EXPECTATIONS.length; patternIndex += 1) {
      entry = MODERN_EXPECTATIONS[patternIndex];
      assert.equal(entry.pattern.test(source), true, filePath + ' should use ' + entry.name);
    }

    for (patternIndex = 0; patternIndex < DISALLOWED_PATTERNS.length; patternIndex += 1) {
      entry = DISALLOWED_PATTERNS[patternIndex];
      assert.equal(entry.pattern.test(source), false, filePath + ' should not use ' + entry.name);
    }
    assert.doesNotMatch(source, /\bvar\b/, filePath + ' should avoid var');
    assert.doesNotMatch(source, /\bwindow\b/, filePath + ' should avoid window');
    assert.doesNotMatch(source, /\bObject\.assign\s*\(/, filePath + ' should avoid Object.assign');
  }
});

test('owned shell source preserves key launch and settings hooks', function () {
  const contentSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src/shell-extension/content/content.js'),
    'utf8'
  );
  const bridgeSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src/shell-extension/content/extension-bridge.js'),
    'utf8'
  );
  const popupSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src/shell-extension/popup/popup.js'),
    'utf8'
  );
  const optionsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src/shell-extension/options/options.js'),
    'utf8'
  );
  const userscriptSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src/shell-userscript/bootstrap.js'),
    'utf8'
  );

  assert.match(contentSource, /pbinfo-launch/);
  assert.match(contentSource, /pbinfo-refresh-settings/);
  assert.match(contentSource, /pbinfo-get-unsolved-extension-start/);

  assert.match(bridgeSource, /PBINFO_GET_UNSOLVED_CACHE_ENABLED/);
  assert.match(bridgeSource, /PBINFO_GET_UNSOLVED_FORCE_REFRESH/);
  assert.match(bridgeSource, /PBINFO_GET_UNSOLVED_NAV_SCOPE/);

  assert.match(popupSource, /pbinfo-launch/);
  assert.match(popupSource, /\.startsWith\('https:\/\/www\.pbinfo\.ro\/'\)/);
  assert.doesNotMatch(popupSource, /!\s*isPbinfoTab\s*\(/);
  assert.match(optionsSource, /pbinfo-refresh-settings/);
  assert.match(userscriptSource, /pbinfo-get-unsolved-userscript-start/);
});
