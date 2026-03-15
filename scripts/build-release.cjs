const fs = require('node:fs');
const path = require('node:path');

const esbuild = require('esbuild');
const { minify } = require('terser');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

async function minifyScript(source, minifyImpl = minify) {
  const result = await minifyImpl(source, {
    compress: true,
    mangle: true,
  });
  if (!result || typeof result.code !== 'string' || result.code.length === 0) {
    throw new Error('Terser did not return minified code.');
  }
  return result.code;
}

function resolveLocalModulePath(fromPath, request) {
  const withExtension = path.extname(request) ? request : `${request}.js`;

  return path.resolve(path.dirname(fromPath), withExtension);
}

function makeModuleId(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function resolvePackageVersion(pkg) {
  return typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : '0.0.0';
}

function renderUserscriptTemplate(userscriptTemplate, minifiedCore, userscriptTemplatePath) {
  const userscriptPlaceholder = '/* __PBINFO_CORE_CODE__ */';
  if (!userscriptTemplate.includes(userscriptPlaceholder)) {
    throw new Error(
      `Userscript template is missing placeholder ${userscriptPlaceholder}: ${userscriptTemplatePath}`
    );
  }
  return userscriptTemplate.replace(userscriptPlaceholder, minifiedCore);
}

async function bundleBrowserEntry(rootDir, entryPath, buildImpl = esbuild.build) {
  const result = await buildImpl({
    absWorkingDir: rootDir,
    entryPoints: [entryPath],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    write: false,
    outfile: 'bundle.js',
    logLevel: 'silent',
    legalComments: 'none',
  });
  const outputFile = Array.isArray(result?.outputFiles) ? result.outputFiles[0] : null;
  if (!outputFile || typeof outputFile.text !== 'string' || outputFile.text.length === 0) {
    throw new Error('esbuild did not return bundled code.');
  }
  return outputFile.text;
}

async function buildRelease() {
  const rootDir = path.resolve(__dirname, '..');
  const pkg = JSON.parse(readText(path.join(rootDir, 'package.json')));
  const version = resolvePackageVersion(pkg);

  const coreSourcePath = path.join(rootDir, 'src', 'core', 'pbinfo-runtime.js');
  const userscriptTemplatePath = path.join(rootDir, 'src', 'shell-userscript', 'bootstrap.js');
  const manifestBasePath = path.join(rootDir, 'src', 'shell-extension', 'manifest.base.json');
  const distDir = path.join(rootDir, 'dist');
  const extensionDistDir = path.join(distDir, 'extension');

  const minifiedCore = await minifyScript(await bundleBrowserEntry(rootDir, coreSourcePath));
  const bookmarkletCore = await minifyScript(
    `(()=>{globalThis.PBINFO_GET_UNSOLVED_OVERLAY=true;${minifiedCore}})();`
  );

  writeText(path.join(distDir, 'pbinfo-get-unsolved.min.js'), minifiedCore);

  const userscriptTemplate = readText(userscriptTemplatePath);
  const userscriptBody = renderUserscriptTemplate(
    userscriptTemplate,
    minifiedCore,
    userscriptTemplatePath
  );
  const userscriptSource = `// ==UserScript==
// @name         pbinfo-get-unsolved
// @namespace    https://github.com/ezluci/pbinfo-get-unsolved
// @version      ${version}
// @description  Userscript scanner for unsolved pbinfo problems.
// @match        https://www.pbinfo.ro/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

${userscriptBody}
`;
  writeText(path.join(distDir, 'pbinfo-get-unsolved.userscript.js'), userscriptSource);
  writeText(
    path.join(distDir, 'pbinfo-get-unsolved.bookmarklet.txt'),
    `javascript:${encodeURIComponent(bookmarkletCore)}`
  );

  const manifestBase = JSON.parse(readText(manifestBasePath));
  const shellFiles = [
    { src: ['src', 'shell-extension', 'content', 'content.js'], dest: 'content.js', minify: true },
    {
      src: ['src', 'shell-extension', 'content', 'extension-bridge.js'],
      dest: 'extension-bridge.js',
      minify: true,
    },
    { src: ['src', 'shell-extension', 'popup', 'popup.html'], dest: 'popup.html', minify: false },
    { src: ['src', 'shell-extension', 'popup', 'popup.js'], dest: 'popup.js', minify: true },
    {
      src: ['src', 'shell-extension', 'options', 'options.html'],
      dest: 'options.html',
      minify: false,
    },
    { src: ['src', 'shell-extension', 'options', 'options.js'], dest: 'options.js', minify: true },
  ];

  for (const target of ['chromium', 'firefox']) {
    const targetDir = path.join(extensionDistDir, target);
    fs.mkdirSync(targetDir, { recursive: true });
    writeText(path.join(targetDir, 'pbinfo-core.js'), minifiedCore);

    for (const file of shellFiles) {
      const sourcePath = path.join(rootDir, ...file.src);
      const source = file.minify
        ? await bundleBrowserEntry(rootDir, sourcePath)
        : readText(sourcePath);
      const output = file.minify ? await minifyScript(source) : source;
      writeText(path.join(targetDir, file.dest), output);
    }

    const manifest = {
      ...manifestBase,
      version,
    };
    if (target === 'firefox') {
      manifest.browser_specific_settings = {
        gecko: {
          id: 'pbinfo-get-unsolved@example.com',
          strict_min_version: '109.0',
        },
      };
    }
    writeText(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }

  console.log(`Wrote ${path.relative(rootDir, path.join(distDir, 'pbinfo-get-unsolved.min.js'))}`);
  console.log(
    `Wrote ${path.relative(rootDir, path.join(distDir, 'pbinfo-get-unsolved.userscript.js'))}`
  );
  console.log(
    `Wrote ${path.relative(rootDir, path.join(distDir, 'pbinfo-get-unsolved.bookmarklet.txt'))}`
  );
  console.log(`Wrote ${path.relative(rootDir, path.join(extensionDistDir, 'chromium'))}`);
  console.log(`Wrote ${path.relative(rootDir, path.join(extensionDistDir, 'firefox'))}`);
}

async function main(runBuild = buildRelease, logError = console.error) {
  try {
    await runBuild();
  } catch (err) {
    logError(err);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main(buildRelease, console.error);
}

module.exports = {
  buildRelease,
  main,
  minifyScript,
  resolveLocalModulePath,
  makeModuleId,
  resolvePackageVersion,
  renderUserscriptTemplate,
  bundleBrowserEntry,
};
