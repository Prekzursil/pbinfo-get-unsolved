'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const { crc32, zipBuffer, renderManifest } = require('../scripts/build-extension.cjs');
const { encodePng } = require('../scripts/generate-icons.cjs');

const MANIFEST_TEMPLATE = JSON.stringify({
  manifest_version: 3,
  name: 'x',
  version: '__VERSION__',
  background: {
    service_worker: 'bg.js',
    scripts: ['bg.js'],
  },
  browser_specific_settings: {
    gecko: { id: 'x@y' },
  },
});

test('crc32: deterministic and matches zlib output', () => {
  const buf = Buffer.from('hello, world!', 'utf8');
  const ours = crc32(buf);
  const theirs = require('node:zlib').crc32(buf);
  assert.equal(ours, theirs);
});

test('zipBuffer: produces archive with valid local file + end-of-central-dir signatures', () => {
  const archive = zipBuffer([
    { name: 'a.txt', data: 'hello' },
    { name: 'dir/b.txt', data: Buffer.from('world') },
  ]);
  // Local file header signature at offset 0.
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  // End of central directory: last 22 bytes, signature 0x06054b50.
  const eocd = archive.slice(archive.length - 22);
  assert.equal(eocd.readUInt32LE(0), 0x06054b50);
  assert.equal(eocd.readUInt16LE(10), 2); // total entries
});

test('zipBuffer: round-trip via zlib inflateRawSync recovers original content', () => {
  const payload = 'x'.repeat(2048) + 'zzz';
  const archive = zipBuffer([{ name: 'p.txt', data: payload }]);
  // Skip local header (30) + name ("p.txt" = 5 bytes).
  const headerLen = 30 + 5;
  const method = archive.readUInt16LE(8);
  const compressedLen = archive.readUInt32LE(18);
  const body = archive.slice(headerLen, headerLen + compressedLen);
  const restored = method === 8 ? zlib.inflateRawSync(body).toString('utf8') : body.toString('utf8');
  assert.equal(restored, payload);
});

test('renderManifest: chrome variant keeps service_worker, drops scripts + gecko settings', () => {
  const m = renderManifest(MANIFEST_TEMPLATE, { browser: 'chrome', version: '9.9.9' });
  assert.equal(m.version, '9.9.9');
  assert.ok(m.background.service_worker);
  assert.ok(!m.background.scripts);
  assert.ok(!m.browser_specific_settings);
});

test('renderManifest: firefox variant keeps scripts, drops service_worker, preserves gecko id', () => {
  const m = renderManifest(MANIFEST_TEMPLATE, { browser: 'firefox', version: '1.2.3' });
  assert.equal(m.version, '1.2.3');
  assert.ok(!m.background.service_worker);
  assert.ok(Array.isArray(m.background.scripts));
  assert.equal(m.browser_specific_settings.gecko.id, 'x@y');
});

test('encodePng: emits a valid PNG signature and IHDR declaring the requested size', () => {
  const png = encodePng(16);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.slice(0, 8).compare(sig), 0);
  // IHDR starts at byte 8: 4-byte length + "IHDR" + 13 bytes of header data.
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(width, 16);
  assert.equal(height, 16);
});
