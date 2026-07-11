/**
 * Standalone verification for lib/phash.ts — run with: node scripts/phash-check.ts
 * (Node 24 strips the TS types; no deps required.)
 *
 * Verifies the pHash behaves the way the AMBER tier needs:
 *   - identical image        => distance 0
 *   - recompression noise    => small distance (would pass an AMBER threshold)
 *   - resize (downsample)    => small distance
 *   - brightness shift       => small distance
 *   - unrelated image        => large distance (must NOT pass AMBER)
 */
import { pHashFromGrayscale, hammingDistanceHex } from "../lib/phash.ts";

type Img = { gray: number[]; w: number; h: number };

function make(w: number, h: number, fn: (x: number, y: number) => number): Img {
  const gray = new Array<number>(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) gray[y * w + x] = Math.max(0, Math.min(255, fn(x, y)));
  }
  return { gray, w, h };
}

function hashOf(img: Img): string {
  return pHashFromGrayscale(img.gray, img.w, img.h);
}

// A structured, photo-like source: diagonal gradient + a couple of soft blobs.
const W = 128;
const H = 96;
const base = make(W, H, (x, y) => {
  const grad = ((x / W) * 140 + (y / H) * 80) as number;
  const blob1 = 90 * Math.exp(-(((x - 40) ** 2 + (y - 30) ** 2) / 500));
  const blob2 = 70 * Math.exp(-(((x - 95) ** 2 + (y - 65) ** 2) / 800));
  return grad + blob1 + blob2;
});

// Recompression-ish: add mild deterministic noise.
const noisy = make(W, H, (x, y) => base.gray[y * W + x] + (((x * 7 + y * 13) % 11) - 5));

// Resize/recompress: half resolution derived from base by averaging 2x2 blocks.
const halfW = W / 2;
const halfH = H / 2;
const resized = make(halfW, halfH, (x, y) => {
  const sx = x * 2;
  const sy = y * 2;
  return (
    (base.gray[sy * W + sx] +
      base.gray[sy * W + sx + 1] +
      base.gray[(sy + 1) * W + sx] +
      base.gray[(sy + 1) * W + sx + 1]) /
    4
  );
});

// Brightness shift: +25 everywhere.
const brighter = make(W, H, (x, y) => base.gray[y * W + x] + 25);

// Unrelated: a radial pattern — fundamentally different low-frequency structure from
// base's diagonal gradient (pHash keys on coarse structure, so this must read as far).
const other = make(W, H, (x, y) => {
  const r = Math.hypot(x - W / 2, y - H / 2);
  return 128 + 120 * Math.sin(r / 6);
});

// Tonal inversion (255 - base). DCT is linear, so every AC coefficient negates and its
// threshold bit flips => near-maximal distance. A hard discrimination check.
const inverted = make(W, H, (x, y) => 255 - base.gray[y * W + x]);

const hBase = hashOf(base);
const results: { name: string; dist: number; expect: string; pass: boolean }[] = [];

function check(name: string, img: Img, cmp: (d: number) => boolean, expect: string) {
  const dist = hammingDistanceHex(hBase, hashOf(img));
  results.push({ name, dist, expect, pass: cmp(dist) });
}

check("identical", base, (d) => d === 0, "== 0");
check("recompression noise", noisy, (d) => d <= 6, "<= 6");
check("resize (half res)", resized, (d) => d <= 8, "<= 8");
check("brightness +25", brighter, (d) => d <= 6, "<= 6");
check("unrelated (radial)", other, (d) => d >= 16, ">= 16");
check("tonal inversion", inverted, (d) => d >= 24, ">= 24");

console.log(`base pHash = ${hBase}\n`);
let allPass = true;
for (const r of results) {
  allPass &&= r.pass;
  console.log(
    `${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(22)} distance=${String(r.dist).padStart(2)}  (expected ${r.expect})`
  );
}
console.log(`\n${allPass ? "ALL PASS ✓" : "SOME FAILED ✗"}`);
process.exit(allPass ? 0 : 1);
