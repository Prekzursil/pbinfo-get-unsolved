'use strict';

// Generates minimal solid-color PNG icons with the project initials ("pb").
// Uses only Node built-ins (zlib) — no extra deps. The PNGs are tiny and
// deterministic so the build is reproducible.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.resolve(__dirname, '..', 'extension', 'icons');

// CRC32 reused from PNG spec (same polynomial as ZIP).
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
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Palette: deep indigo background (#0f172a), cyan foreground (#38bdf8) for the
// inset disc, white (#f8fafc) for the "pb" mark.
const BG = [0x0f, 0x17, 0x2a];
const DISC = [0x38, 0xbd, 0xf8];
const FG = [0xf8, 0xfa, 0xfc];

function isInsideDisc(x, y, size) {
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const r = size * 0.44;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// Draws a simple "pb" shape by rasterizing two rounded rectangles:
//   - left stem of "p"
//   - bowl of "p"
//   - ascender of "b"
//   - bowl of "b"
// We approximate with pixel masks so the result is legible even at 16px.
function pbPixel(x, y, size) {
  const unit = size / 16;
  const gx = x / unit;
  const gy = y / unit;
  // "p" bowl (columns 3-7, rows 6-10)
  if (gx >= 3 && gx <= 7 && gy >= 6 && gy <= 10) {
    const ringDx = gx - 5;
    const ringDy = gy - 8;
    const ringDist = ringDx * ringDx + ringDy * ringDy;
    if (ringDist >= 1.2 && ringDist <= 4.5) return true;
  }
  // "p" stem (column 3, rows 6-12)
  if (gx >= 3 && gx <= 3.9 && gy >= 6 && gy <= 12) return true;
  // "b" stem (column 9, rows 3-10)
  if (gx >= 9 && gx <= 9.9 && gy >= 3 && gy <= 10) return true;
  // "b" bowl (columns 9-12, rows 6-10)
  if (gx >= 9 && gx <= 12 && gy >= 6 && gy <= 10) {
    const ringDx = gx - 11;
    const ringDy = gy - 8;
    const ringDist = ringDx * ringDx + ringDy * ringDy;
    if (ringDist >= 0.9 && ringDist <= 4) return true;
  }
  return false;
}

function rasterize(size) {
  const rowLen = size * 3 + 1; // filter byte + RGB row
  const rows = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    rows[y * rowLen] = 0; // no filter
    for (let x = 0; x < size; x++) {
      const inside = isInsideDisc(x, y, size);
      let color = inside ? DISC : BG;
      if (inside && pbPixel(x, y, size)) color = FG;
      const off = y * rowLen + 1 + x * 3;
      rows[off] = color[0];
      rows[off + 1] = color[1];
      rows[off + 2] = color[2];
    }
  }
  return rows;
}

function encodePng(size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = rasterize(size);
  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    const png = encodePng(size);
    const file = path.join(OUT_DIR, `icon-${size}.png`);
    fs.writeFileSync(file, png);
    console.log(
      `Wrote ${path.relative(path.resolve(__dirname, '..'), file)} (${png.length} bytes)`
    );
  }
}

if (require.main === module) {
  main();
}

module.exports = { encodePng, crc32 };
