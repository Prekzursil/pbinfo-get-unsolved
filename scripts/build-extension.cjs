'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const rootDir = path.resolve(__dirname, '..');
const extDir = path.join(rootDir, 'extension');
const distDir = path.join(rootDir, 'dist');
const pkgPath = path.join(rootDir, 'package.json');
const templatePath = path.join(extDir, 'manifest.template.json');
const librarySource = path.join(rootDir, 'pbinfo-get-unsolved-enhanced.js');

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function renderManifest(template, { browser, version }) {
  const json = JSON.parse(template);
  json.version = version;
  if (browser === 'chrome') {
    // Chrome ignores browser_specific_settings and wants service_worker.
    delete json.browser_specific_settings;
    if (json.background) {
      delete json.background.scripts;
    }
  } else if (browser === 'firefox') {
    // Firefox MV3 uses background.scripts (no service_worker).
    if (json.background) {
      delete json.background.service_worker;
    }
  }
  return json;
}

// Minimal deterministic ZIP writer (store-only, no compression dep).
// Produces a valid .zip archive usable by chrome://extensions and web-ext.
// Based on the ZIP spec with stored (method 0) + DEFLATE (method 8) fallback.
function zipBuffer(entries) {
  const fileBuffers = [];
  const centralBuffers = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const uncompressed = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const crc = crc32(uncompressed);

    // Use DEFLATE when it shrinks the payload, otherwise store.
    const deflated = zlib.deflateRawSync(uncompressed, { level: 9 });
    const useDeflate = deflated.length < uncompressed.length;
    const body = useDeflate ? deflated : uncompressed;
    const method = useDeflate ? 8 : 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(method, 8); // method
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x21, 12); // mod date (static for determinism)
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(body.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    fileBuffers.push(localHeader, nameBuf, body);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0x21, 14); // mod date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(body.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra
    centralHeader.writeUInt16LE(0, 32); // comment
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // offset of local header

    centralBuffers.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + body.length;
  }

  const filePart = Buffer.concat(fileBuffers);
  const centralPart = Buffer.concat(centralBuffers);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // disk
  end.writeUInt16LE(0, 6); // disk of central dir
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralPart.length, 12);
  end.writeUInt32LE(filePart.length, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([filePart, centralPart, end]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function collectFiles(root, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, rel));
    } else if (entry.isFile()) {
      out.push({ name: rel, data: fs.readFileSync(full) });
    }
  }
  return out;
}

function buildExtensionForBrowser(browser, { version, userscriptLibBody }) {
  const template = readText(templatePath);
  const manifest = renderManifest(template, { browser, version });

  // Collect static assets (popup/, content/, background/, icons/)
  const staticDirs = ['background', 'content', 'popup', 'icons'];
  const files = [];

  files.push({
    name: 'manifest.json',
    data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
  });

  for (const dir of staticDirs) {
    const full = path.join(extDir, dir);
    if (!fs.existsSync(full)) continue;
    for (const entry of collectFiles(full, dir)) {
      files.push(entry);
    }
  }

  // Inject the library body into content/pbinfo-get-unsolved.lib.js so the
  // content-injected <script> can bootstrap window.pbinfoGetUnsolvedStart.
  files.push({
    name: 'content/pbinfo-get-unsolved.lib.js',
    data: Buffer.from(userscriptLibBody, 'utf8'),
  });

  return zipBuffer(files);
}

function main() {
  const pkg = JSON.parse(readText(pkgPath));
  const version = typeof pkg.version === 'string' ? pkg.version : '0.0.0';

  // Build the library body that the content-injected script will execute in
  // the page MAIN world. The source auto-defines window.pbinfoGetUnsolvedStart
  // and (with NO_AUTORUN) does not run immediately.
  const librarySrc = readText(librarySource);
  const userscriptLibBody =
    [
      'window.PBINFO_GET_UNSOLVED_NO_AUTORUN = true;',
      'if (typeof window.PBINFO_GET_UNSOLVED_OVERLAY === "undefined") {',
      '  window.PBINFO_GET_UNSOLVED_OVERLAY = true;',
      '}',
      '(function () {',
      '  if (window.__PBINFO_GET_UNSOLVED_EXT_LIB_READY__) return;',
      '  window.__PBINFO_GET_UNSOLVED_EXT_LIB_READY__ = true;',
      librarySrc,
      '})();',
    ].join('\n') + '\n';

  ensureDir(distDir);

  const chromeZip = buildExtensionForBrowser('chrome', { version, userscriptLibBody });
  const firefoxZip = buildExtensionForBrowser('firefox', { version, userscriptLibBody });

  const chromePath = path.join(distDir, `pbinfo-get-unsolved-chrome-v${version}.zip`);
  const firefoxPath = path.join(distDir, `pbinfo-get-unsolved-firefox-v${version}.xpi`);

  fs.writeFileSync(chromePath, chromeZip);
  fs.writeFileSync(firefoxPath, firefoxZip);

  console.log(`Wrote ${path.relative(rootDir, chromePath)} (${chromeZip.length} bytes)`);
  console.log(`Wrote ${path.relative(rootDir, firefoxPath)} (${firefoxZip.length} bytes)`);
}

if (require.main === module) {
  main();
}

module.exports = {
  crc32,
  zipBuffer,
  renderManifest,
};
