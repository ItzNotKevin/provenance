/**
 * Encodes a 16-char hex pHash (see lib/phash.ts) as a 64-dimensional signed vector so
 * Atlas Vector Search's Euclidean similarity can approximate Hamming distance for fast
 * ANN candidate retrieval, instead of a full collection scan.
 *
 * For two vectors whose elements are each in {-1, +1}, squared Euclidean distance equals
 * 4 * (number of differing positions) — i.e. 4 * Hamming distance. That's a strictly
 * monotonic function of Hamming distance, so ranking by Euclidean distance over these
 * vectors produces exactly the same order as ranking by Hamming distance directly. Atlas
 * only sees "nearest vectors"; the AMBER tier still re-derives the exact Hamming distance
 * afterward (see mongo.ts findAmberCandidates) before anything is shown or chain-confirmed.
 *
 * Bit order matches lib/phash.ts's pHashFromGrayscale packing exactly: within each hex
 * nibble, bit value 8 (MSB) is pushed first, bit value 1 (LSB) last.
 */

export const PHASH_VECTOR_DIMENSIONS = 64;

const HEX_16 = /^[0-9a-fA-F]{16}$/;

export function phashHexToVector(hex: string): number[] {
  if (!HEX_16.test(hex)) {
    throw new Error(`phash must be 16 hex characters, got ${JSON.stringify(hex)}`);
  }
  const vec: number[] = new Array(PHASH_VECTOR_DIMENSIONS);
  let i = 0;
  for (const ch of hex) {
    const nibble = parseInt(ch, 16);
    vec[i++] = nibble & 0b1000 ? 1 : -1;
    vec[i++] = nibble & 0b0100 ? 1 : -1;
    vec[i++] = nibble & 0b0010 ? 1 : -1;
    vec[i++] = nibble & 0b0001 ? 1 : -1;
  }
  return vec;
}
