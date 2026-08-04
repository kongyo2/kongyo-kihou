/**
 * 拡張アイコンの生成。`images/icon.png` を決定的に描く。
 *
 * 図案は記法の核心そのもの：末尾の「→」（未判定）が、判定日に「○ × －」の
 * いずれかへ置換される（§6）。金の矢印が問いで、下の三つの記号が世界の答え。
 *
 * 依存を持たないため、PNG は自前で束ねる（IHDR / IDAT / IEND、フィルタ 0、
 * zlib は node:zlib）。形は 4×4 の超標本化で縁を均す。フォントは使わない。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const SIZE = 256;
const SUPER = 4;
const GRID = SIZE * SUPER;

type Rgba = readonly [number, number, number, number];

const BG_TOP: Rgba = [0x23, 0x28, 0x3e, 0xff];
const BG_BOTTOM: Rgba = [0x14, 0x16, 0x20, 0xff];
const GOLD: Rgba = [0xe2, 0xb9, 0x3d, 0xff];
const HIT: Rgba = [0xd9, 0xdf, 0xea, 0xff];
const MISS: Rgba = [0xa8, 0xb1, 0xc4, 0xff];
const UNDECIDABLE: Rgba = [0x77, 0x80, 0x93, 0xff];
const TRANSPARENT: Rgba = [0, 0, 0, 0];

const CORNER_RADIUS = 0.12;

/** 角丸の内側か。矩形の SDF を丸めた形。 */
function insideRoundedSquare(x: number, y: number): boolean {
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - CORNER_RADIUS), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - CORNER_RADIUS), 0);
  return dx * dx + dy * dy <= CORNER_RADIUS * CORNER_RADIUS;
}

const ARROW_Y = 0.4;
const ARROW_SHAFT_HALF = 0.045;
const ARROW_SHAFT_FROM = 0.2;
const ARROW_SHAFT_TO = 0.615;
const ARROW_HEAD_FROM = 0.585;
const ARROW_HEAD_TIP = 0.8;
const ARROW_HEAD_HALF = 0.12;

function insideArrow(x: number, y: number): boolean {
  if (x >= ARROW_SHAFT_FROM && x <= ARROW_SHAFT_TO && Math.abs(y - ARROW_Y) <= ARROW_SHAFT_HALF) {
    return true;
  }
  if (x >= ARROW_HEAD_FROM && x <= ARROW_HEAD_TIP) {
    const taper = (ARROW_HEAD_TIP - x) / (ARROW_HEAD_TIP - ARROW_HEAD_FROM);
    return Math.abs(y - ARROW_Y) <= ARROW_HEAD_HALF * taper;
  }
  return false;
}

const MARKS_Y = 0.715;
const STROKE = 0.021;

const CIRCLE_X = 0.285;
const CIRCLE_R = 0.062;

function insideCircleMark(x: number, y: number): boolean {
  const distance = Math.hypot(x - CIRCLE_X, y - MARKS_Y);
  return Math.abs(distance - CIRCLE_R) <= STROKE;
}

const CROSS_X = 0.5;
const CROSS_ARM = 0.062;

function insideCrossMark(x: number, y: number): boolean {
  const dx = x - CROSS_X;
  const dy = y - MARKS_Y;
  const u = (dx + dy) / Math.SQRT2;
  const v = (dx - dy) / Math.SQRT2;
  if (Math.abs(u) <= CROSS_ARM && Math.abs(v) <= STROKE) return true;
  return Math.abs(v) <= CROSS_ARM && Math.abs(u) <= STROKE;
}

const DASH_X = 0.715;
const DASH_HALF = 0.062;

function insideDashMark(x: number, y: number): boolean {
  return Math.abs(x - DASH_X) <= DASH_HALF && Math.abs(y - MARKS_Y) <= STROKE;
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function sampleAt(x: number, y: number): Rgba {
  if (!insideRoundedSquare(x, y)) return TRANSPARENT;
  if (insideArrow(x, y)) return GOLD;
  if (insideCircleMark(x, y)) return HIT;
  if (insideCrossMark(x, y)) return MISS;
  if (insideDashMark(x, y)) return UNDECIDABLE;
  return [
    lerpChannel(BG_TOP[0], BG_BOTTOM[0], y),
    lerpChannel(BG_TOP[1], BG_BOTTOM[1], y),
    lerpChannel(BG_TOP[2], BG_BOTTOM[2], y),
    0xff,
  ];
}

/** 4×4 標本の平均で 1 画素を決める。透明は α 加重で混ぜる。 */
function renderPixels(): Uint8Array {
  const out = new Uint8Array(SIZE * SIZE * 4);
  for (let py = 0; py < SIZE; py += 1) {
    for (let px = 0; px < SIZE; px += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let sy = 0; sy < SUPER; sy += 1) {
        for (let sx = 0; sx < SUPER; sx += 1) {
          const x = (px * SUPER + sx + 0.5) / GRID;
          const y = (py * SUPER + sy + 0.5) / GRID;
          const [r, g, b, a] = sampleAt(x, y);
          red += r * a;
          green += g * a;
          blue += b * a;
          alpha += a;
        }
      }
      const samples = SUPER * SUPER;
      const offset = (py * SIZE + px) * 4;
      if (alpha === 0) continue;
      out[offset] = Math.round(red / alpha);
      out[offset + 1] = Math.round(green / alpha);
      out[offset + 2] = Math.round(blue / alpha);
      out[offset + 3] = Math.round(alpha / samples);
    }
  }
  return out;
}

const CRC_TABLE: readonly number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function encodePng(pixels: Uint8Array): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, SIZE);
  ihdrView.setUint32(4, SIZE);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 各走査線の先頭にフィルタ 0 を置く。
  const raw = new Uint8Array(SIZE * (1 + SIZE * 4));
  for (let y = 0; y < SIZE; y += 1) {
    const rowStart = y * (1 + SIZE * 4);
    raw[rowStart] = 0;
    raw.set(pixels.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), rowStart + 1);
  }
  const idat = new Uint8Array(deflateSync(raw, { level: 9 }));

  const parts = [signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const target = resolve(process.cwd(), "images/icon.png");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, encodePng(renderPixels()));
console.log(`[kongyo] icon written — ${target} (${String(SIZE)}×${String(SIZE)})`);
