// Generates the DrawWithSmile app icons (PNG) with no image libraries.
// Run: node scripts/generate-icons.mjs   (writes to public/icons)
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const OUT = new URL('../public/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const INK = [31, 37, 68];
const SUN = [255, 200, 61];
const CREAM = [255, 248, 236];
const CHEEK = [255, 150, 150];

/** Colour of one point (unit coordinates) or null for transparent. */
function sample(x, y, maskable) {
  let color = null;
  if (maskable) color = SUN;
  else {
    // Rounded square background.
    const r = 0.22;
    const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
    const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
    if (Math.hypot(dx, dy) <= r) color = CREAM;
  }
  const R = maskable ? 0.3 : 0.38; // maskable icons keep content inside the safe zone
  const cx = 0.5;
  const cy = 0.5;
  const d = Math.hypot(x - cx, y - cy);
  const stroke = R * 0.12;
  if (d <= R) color = d > R - stroke ? INK : maskable ? [255, 225, 120] : SUN;
  if (d > R - stroke) return color;

  for (const chx of [cx - 0.58 * R, cx + 0.58 * R]) {
    if (Math.hypot(x - chx, y - (cy + 0.12 * R)) < 0.13 * R) color = CHEEK;
  }
  for (const ex of [cx - 0.3 * R, cx + 0.3 * R]) {
    if (Math.hypot(x - ex, y - (cy - 0.18 * R)) < 0.11 * R) color = INK;
  }
  // Smile: arc of a circle below the eyes.
  const sx = cx;
  const sy = cy - 0.05 * R;
  const sd = Math.hypot(x - sx, y - sy);
  if (Math.abs(sd - 0.55 * R) < stroke / 2 && y > sy + 0.18 * R) color = INK;
  return color;
}

function png(size, maskable) {
  const SS = 4; // 4x4 supersampling for smooth edges
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, maskable);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [72, 96, 128, 144, 152, 192, 384, 512]) {
  writeFileSync(new URL(`icon-${size}x${size}.png`, OUT), png(size, false));
}
for (const size of [192, 512]) {
  writeFileSync(new URL(`maskable-${size}x${size}.png`, OUT), png(size, true));
}
writeFileSync(new URL('apple-touch-icon.png', OUT), png(180, true));
console.log('Icons written to public/icons');
