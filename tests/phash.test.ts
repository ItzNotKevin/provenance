import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pHashFromGrayscale,
  pHashFromRgba,
  rgbaToGrayscale,
  hammingDistanceHex,
} from "../lib/phash.ts";

// --- synthetic images (grayscale, gray[y*w + x] in [0,255]) ---
type Img = { gray: number[]; w: number; h: number };
function make(w: number, h: number, fn: (x: number, y: number) => number): Img {
  const gray = new Array<number>(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) gray[y * w + x] = Math.max(0, Math.min(255, fn(x, y)));
  return { gray, w, h };
}
const hash = (i: Img) => pHashFromGrayscale(i.gray, i.w, i.h);

const W = 128;
const H = 96;
const base = make(W, H, (x, y) => {
  const grad = (x / W) * 140 + (y / H) * 80;
  const blob1 = 90 * Math.exp(-(((x - 40) ** 2 + (y - 30) ** 2) / 500));
  const blob2 = 70 * Math.exp(-(((x - 95) ** 2 + (y - 65) ** 2) / 800));
  return grad + blob1 + blob2;
});

test("pHash is 16 hex chars (64 bits)", () => {
  const h = hash(base);
  assert.equal(h.length, 16);
  assert.match(h, /^[0-9a-f]{16}$/);
});

test("pHash is deterministic", () => {
  assert.equal(hash(base), hash(base));
});

test("derivatives stay within the amber threshold (recompress/resize/brightness)", () => {
  const noisy = make(W, H, (x, y) => base.gray[y * W + x] + (((x * 7 + y * 13) % 11) - 5));
  const brighter = make(W, H, (x, y) => base.gray[y * W + x] + 25);
  const resized = make(W / 2, H / 2, (x, y) => {
    const sx = x * 2, sy = y * 2;
    return (
      (base.gray[sy * W + sx] + base.gray[sy * W + sx + 1] +
        base.gray[(sy + 1) * W + sx] + base.gray[(sy + 1) * W + sx + 1]) / 4
    );
  });
  const hBase = hash(base);
  assert.ok(hammingDistanceHex(hBase, hash(noisy)) <= 6, "noise");
  assert.ok(hammingDistanceHex(hBase, hash(brighter)) <= 6, "brightness");
  assert.ok(hammingDistanceHex(hBase, hash(resized)) <= 8, "resize");
});

test("unrelated images are far apart (no false amber)", () => {
  const radial = make(W, H, (x, y) => 128 + 120 * Math.sin(Math.hypot(x - W / 2, y - H / 2) / 6));
  const inverted = make(W, H, (x, y) => 255 - base.gray[y * W + x]);
  const hBase = hash(base);
  assert.ok(hammingDistanceHex(hBase, hash(radial)) >= 16, "radial");
  // tonal inversion flips every AC bit => near-maximal distance
  assert.ok(hammingDistanceHex(hBase, hash(inverted)) >= 24, "inversion");
});

test("hammingDistanceHex: identical=0, known diffs, length mismatch throws", () => {
  assert.equal(hammingDistanceHex("0000000000000000", "0000000000000000"), 0);
  assert.equal(hammingDistanceHex("0000000000000000", "000000000000000f"), 4); // one nibble = 4 bits
  assert.equal(hammingDistanceHex("0000000000000000", "ffffffffffffffff"), 64);
  assert.throws(() => hammingDistanceHex("abcd", "abcdef"));
});

test("rgbaToGrayscale + pHashFromRgba agree with the grayscale path", () => {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = base.gray[i];
    rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
  }
  const gray = rgbaToGrayscale(rgba, W, H);
  // gray of a gray pixel ≈ the pixel value
  assert.ok(Math.abs(gray[0] - base.gray[0]) < 1);
  assert.equal(pHashFromRgba(rgba, W, H), pHashFromGrayscale(gray, W, H));
});
