// Writes the app icon as a PNG. iOS home screens ignore SVG apple-touch-icons,
// so "Add to Home Screen" needs a real raster file. No image library here, just
// zlib and the PNG spec: a green field with a rising white bar chart.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const S = 512;
const BG = [0x2e, 0x7d, 0x4f];
const FG = [0xff, 0xff, 0xff];

// Bars rising left to right, plus a baseline, in a 512 grid.
const bars = [
  { x: 96, w: 60, top: 300 },
  { x: 176, w: 60, top: 236 },
  { x: 256, w: 60, top: 176 },
  { x: 336, w: 60, top: 108 },
];
const baseY = 372;
const baseH = 18;

const px = (x, y) => {
  if (y >= baseY && y < baseY + baseH && x >= 88 && x < 404) return FG;
  for (const b of bars) if (x >= b.x && x < b.x + b.w && y >= b.top && y < baseY) return FG;
  return BG;
};

// Raw scanlines: one filter byte (0 = none) then RGB triples.
const raw = Buffer.alloc(S * (1 + S * 3));
let o = 0;
for (let y = 0; y < S; y++) {
  raw[o++] = 0;
  for (let x = 0; x < S; x++) {
    const [r, g, b] = px(x, y);
    raw[o++] = r;
    raw[o++] = g;
    raw[o++] = b;
  }
}

const table = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type 2 = truecolour
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = process.argv[2];
writeFileSync(out, png);
process.stdout.write(`wrote ${out}, ${S}x${S}, ${(png.length / 1024).toFixed(1)} kB\n`);
