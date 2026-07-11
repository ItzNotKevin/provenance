import { test } from "node:test";
import assert from "node:assert/strict";
import { phashHexToVector, PHASH_VECTOR_DIMENSIONS } from "../src/phashVector.ts";
import { hammingDistanceHex } from "../../lib/phash.ts";

function squaredEuclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return sum;
}

test("produces a 64-dimensional vector of only ±1", () => {
  const vec = phashHexToVector("a3f09c1e77bb0021");
  assert.equal(vec.length, PHASH_VECTOR_DIMENSIONS);
  for (const v of vec) assert.ok(v === 1 || v === -1);
});

test("squared Euclidean distance equals 4 * Hamming distance (the ANN/exact correlation vector search relies on)", () => {
  const pairs: [string, string][] = [
    ["0000000000000000", "0000000000000000"], // identical
    ["0000000000000000", "ffffffffffffffff"], // maximally different (all 64 bits)
    ["a3f09c1e77bb0021", "a3f09c1e77bb0021"], // identical, non-trivial
    ["a3f09c1e77bb0021", "a3f09c1e77bb0020"], // differ by 1 bit
    ["1234567890abcdef", "fedcba0987654321"], // arbitrary pair
  ];
  for (const [a, b] of pairs) {
    const hamming = hammingDistanceHex(a, b);
    const sqEuclidean = squaredEuclidean(phashHexToVector(a), phashHexToVector(b));
    assert.equal(sqEuclidean, 4 * hamming, `mismatch for ${a} vs ${b}`);
  }
});

test("rejects non-16-char-hex input", () => {
  assert.throws(() => phashHexToVector("abc"));
  assert.throws(() => phashHexToVector("zzzzzzzzzzzzzzzz"));
});

test("bit order matches lib/phash.ts: MSB of each nibble first", () => {
  // '8' = 0b1000 → only the MSB set → vector should be [1, -1, -1, -1] for that nibble
  const vec = phashHexToVector("8000000000000000");
  assert.deepEqual(vec.slice(0, 4), [1, -1, -1, -1]);
  // '1' = 0b0001 → only the LSB set → [-1, -1, -1, 1]
  const vec2 = phashHexToVector("1000000000000000");
  assert.deepEqual(vec2.slice(0, 4), [-1, -1, -1, 1]);
});
