import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { computePhashFromImageBytes, ImageDecodeError } from "../src/imagePhash.ts";
import { pHashFromRgba, hammingDistanceHex } from "../../lib/phash.ts";

// Uses sharp itself to generate synthetic test images (no fixture files needed) — this
// exercises the real decode path (encode → real PNG/JPEG bytes → sharp decode → pHash),
// not just the pure core already covered by tests/phash.test.ts.

const W = 64;
const H = 48;

function makeRawRgba(fn: (x: number, y: number) => number): Buffer {
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.max(0, Math.min(255, Math.round(fn(x, y))));
      const i = (y * W + x) * 4;
      buf[i] = v;
      buf[i + 1] = v;
      buf[i + 2] = v;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

const baseRaw = makeRawRgba((x, y) => (x / W) * 180 + (y / H) * 60 + 40 * Math.sin(x / 5));

test("computes a valid 16-hex-char pHash from a real encoded PNG, matching the pure core", async () => {
  const png = await sharp(baseRaw, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  const hash = await computePhashFromImageBytes(png);
  assert.match(hash, /^[0-9a-f]{16}$/);
  // PNG is lossless, so decoding it back should reproduce the exact same pixels the pure
  // core (already verified by tests/phash.test.ts) would hash directly.
  const expected = pHashFromRgba(baseRaw, W, H);
  assert.equal(hash, expected);
});

test("a recompressed JPEG derivative stays within the amber threshold of the original", async () => {
  const png = await sharp(baseRaw, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  const jpeg = await sharp(baseRaw, { raw: { width: W, height: H, channels: 4 } })
    .jpeg({ quality: 70 })
    .toBuffer();
  const hashPng = await computePhashFromImageBytes(png);
  const hashJpeg = await computePhashFromImageBytes(jpeg);
  assert.ok(
    hammingDistanceHex(hashPng, hashJpeg) <= 10,
    `expected recompression to stay close, got ${hammingDistanceHex(hashPng, hashJpeg)}`
  );
});

test("an unrelated image is far apart (no false amber)", async () => {
  const inverted = makeRawRgba((x, y) => 255 - (x / W) * 180 - (y / H) * 60 - 40 * Math.sin(x / 5));
  const pngBase = await sharp(baseRaw, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  const pngInverted = await sharp(inverted, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  const hashBase = await computePhashFromImageBytes(pngBase);
  const hashInverted = await computePhashFromImageBytes(pngInverted);
  assert.ok(hammingDistanceHex(hashBase, hashInverted) >= 16);
});

test("rejects garbage bytes with ImageDecodeError", async () => {
  await assert.rejects(() => computePhashFromImageBytes(Buffer.from("not an image")), ImageDecodeError);
});
