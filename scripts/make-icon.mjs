#!/usr/bin/env node
// Renders the FreeChain application icon (two interlocked steel-grey chain
// links, matching the ⛓️ favicon used in the web dashboard) and packs it into
// a multi-resolution Windows .ico at assets/icon.ico.
//
// No image libraries: a software rasterizer draws the shape via signed
// distance fields at a large master size, then box-downsamples to each icon
// size, and a minimal hand-rolled PNG encoder (using only node:zlib) packs
// the frames into the .ico container. Re-run this after changing the design;
// the output is a committed binary asset, not generated at build time.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'icon.ico');
const PREVIEW = path.join(ROOT, 'assets', 'icon-preview.png');

// 768 divides evenly into every target icon size below, so each is a clean
// integer box-downsample of the same master render (consistent AA, no re-render).
const MASTER = 768;
const SIZES = [16, 32, 48, 64, 128, 256];

// --- signed-distance-field capsule ("stadium") ring, the classic flat
// "link" glyph shape: a rounded-rectangle band, rotated. ------------------

function capsuleSDF(x, y, halfLen, radius) {
  const cx = Math.max(-halfLen, Math.min(halfLen, x));
  return Math.hypot(x - cx, y) - radius;
}

function ringSample(px, py, cx, cy, angleDeg, halfLen, thickness, outerRadius) {
  const a = (-angleDeg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  const innerRadius = outerRadius - thickness;
  const dOuter = capsuleSDF(lx, ly, halfLen, outerRadius); // <0 inside outer
  const dInner = capsuleSDF(lx, ly, halfLen, innerRadius); // <0 inside inner (the hole)
  // Coverage via smooth edges (antialiasing), band = inside outer AND outside inner.
  const covOuter = smoothstep(0.9, -0.9, dOuter);
  const covInner = smoothstep(-0.9, 0.9, dInner);
  const coverage = Math.min(covOuter, covInner);
  if (coverage <= 0) return null;
  // Shade like a lit round bar: brightest a bit past the inner edge, darker
  // at both edges of the band, biased so the highlight sits up-and-left.
  const t = clamp((-dInner) / thickness, 0, 1); // 0 at inner edge, 1 at outer edge
  const lit = 1 - (t - 0.38) * (t - 0.38) * 2.6;
  return { coverage, lit: clamp(lit, 0.35, 1) };
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Two rings, mirrored, overlapping in the centre like the ⛓️ glyph.
const RINGS = [
  { offset: -0.16, angle: 40, base: [0x9a, 0xa4, 0xb0] },
  { offset: 0.16, angle: -40, base: [0x76, 0x82, 0x90] },
];

function renderMaster(size) {
  const buf = new Float64Array(size * size * 4); // RGBA, straight alpha, 0..1
  const halfLen = size * 0.24;
  const thickness = size * 0.1;
  const outerRadius = size * 0.155;
  const outline = [0x3a, 0x40, 0x48];

  for (let ri = 0; ri < RINGS.length; ri++) {
    const ring = RINGS[ri];
    const cx = size / 2 + ring.offset * size;
    const cy = size / 2 - ring.offset * size * 0.4;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = ringSample(x + 0.5, y + 0.5, cx, cy, ring.angle, halfLen, thickness, outerRadius);
        if (!s) continue;
        const [br, bg, bb] = ring.base;
        let r = br * s.lit;
        let g = bg * s.lit;
        let b = bb * s.lit;
        // Thin dark outline near the band edges for definition at small sizes.
        const edgeDist = Math.min(s.coverage, 1);
        if (edgeDist < 1) {
          const k = 1 - edgeDist;
          r = r * (1 - k) + outline[0] * k;
          g = g * (1 - k) + outline[1] * k;
          b = b * (1 - k) + outline[2] * k;
        }
        const i = (y * size + x) * 4;
        const a = s.coverage;
        // Straight-alpha "over" compositing across the two rings.
        const prevA = buf[i + 3];
        const outA = a + prevA * (1 - a);
        if (outA <= 0) continue;
        buf[i + 0] = (r * a + buf[i + 0] * prevA * (1 - a)) / outA;
        buf[i + 1] = (g * a + buf[i + 1] * prevA * (1 - a)) / outA;
        buf[i + 2] = (b * a + buf[i + 2] * prevA * (1 - a)) / outA;
        buf[i + 3] = outA;
      }
    }
  }
  return buf;
}

function downsample(master, masterSize, targetSize) {
  const factor = masterSize / targetSize;
  if (!Number.isInteger(factor)) throw new Error(`${masterSize} not divisible by ${targetSize}`);
  const out = new Uint8ClampedArray(targetSize * targetSize * 4);
  const area = factor * factor;
  for (let ty = 0; ty < targetSize; ty++) {
    for (let tx = 0; tx < targetSize; tx++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const mx = tx * factor + sx;
          const my = ty * factor + sy;
          const i = (my * masterSize + mx) * 4;
          const pa = master[i + 3];
          r += master[i + 0] * pa;
          g += master[i + 1] * pa;
          b += master[i + 2] * pa;
          a += pa;
        }
      }
      const outA = a / area;
      const oi = (ty * targetSize + tx) * 4;
      if (outA > 0) {
        out[oi + 0] = r / a;
        out[oi + 1] = g / a;
        out[oi + 2] = b / a;
      }
      out[oi + 3] = Math.round(outA * 255);
    }
  }
  return out;
}

// --- minimal PNG encoder (8-bit RGBA, filter type 0, zlib via node:zlib) --

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
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(rgba, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: None
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- ICO container (PNG-compressed frames, valid on Vista+) --------------

function encodeICO(frames) {
  const count = frames.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  const datas = [];
  let offset = 6 + count * 16;
  for (const { size, png } of frames) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // no palette
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    datas.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...datas]);
}

console.log(`· rendering master at ${MASTER}px`);
const master = renderMaster(MASTER);

const frames = SIZES.map((size) => {
  console.log(`· rasterizing ${size}x${size}`);
  const rgba = downsample(master, MASTER, size);
  return { size, png: encodePNG(rgba, size) };
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, encodeICO(frames));
console.log(`· wrote ${path.relative(ROOT, OUT)} (${frames.length} sizes: ${SIZES.join(', ')})`);

// A plain PNG at the largest size, purely so the result can be eyeballed.
fs.writeFileSync(PREVIEW, frames[frames.length - 1].png);
console.log(`· wrote ${path.relative(ROOT, PREVIEW)} for preview`);
