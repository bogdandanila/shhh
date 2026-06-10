// Generates renderer/trayTemplate.png (16px) and @2x (32px): a black mic glyph
// with alpha, used as a macOS template image. Run once: node scripts/gen-tray-icon.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, alphaAt) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0 + RGBA
    for (let x = 0; x < size; x++) row[1 + x * 4 + 3] = alphaAt(x, y); // black, alpha only
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Mic glyph in a 16-unit space: capsule body, lower holder arc, stem, base.
function inGlyph(px, py) {
  const distSeg = (x, y, x1, y1, x2, y2) => {
    const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / ((x2 - x1) ** 2 + (y2 - y1) ** 2 || 1)));
    return Math.hypot(x - (x1 + t * (x2 - x1)), y - (y1 + t * (y2 - y1)));
  };
  if (distSeg(px, py, 8, 4.6, 8, 7.6) <= 2.6) return true;                 // capsule
  const dc = Math.hypot(px - 8, py - 7.8);
  if (py >= 7.8 && dc >= 4.0 && dc <= 5.2) return true;                    // holder arc
  if (px >= 7.3 && px <= 8.7 && py >= 12.0 && py <= 14.0) return true;     // stem
  if (px >= 5.0 && px <= 11.0 && py >= 13.6 && py <= 14.8) return true;    // base
  return false;
}

function alphaAt(scale) {
  return (x, y) => {
    let hits = 0;
    const N = 4; // 4x4 supersampling for soft edges
    for (let sy = 0; sy < N; sy++) {
      for (let sx = 0; sx < N; sx++) {
        if (inGlyph(((x + (sx + 0.5) / N) * 16) / (16 * scale), ((y + (sy + 0.5) / N) * 16) / (16 * scale))) hits++;
      }
    }
    return Math.round((hits / (N * N)) * 255);
  };
}

writeFileSync('renderer/trayTemplate.png', png(16, alphaAt(1)));
writeFileSync('renderer/trayTemplate@2x.png', png(32, alphaAt(2)));
console.log('wrote renderer/trayTemplate.png + @2x');
