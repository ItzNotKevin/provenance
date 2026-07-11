/**
 * Perceptual hash (pHash) — 64-bit DCT-based fingerprint for the AMBER tier.
 *
 * SHA-256 answers "is this the exact same bytes" (GREEN). pHash answers "is this the
 * same picture, recompressed/resized" — it survives an Instagram round-trip but breaks
 * on crops/rotations/big overlays. Its rigidity is the point: it only matches actual
 * derivatives, so a false "yes" is hard.
 *
 * This module is PURE and platform-agnostic (no react-native / no web imports) so it can
 * run identically on the capture device, in the verifier backend (with `sharp`/`jimp`
 * decoding pixels), and in a plain Node test. Pixel *extraction* is platform glue and
 * lives elsewhere — feed grayscale in, get a hex hash out.
 *
 * Pipeline (classic Krawetz pHash):
 *   grayscale → box-resize to 32×32 → 2D DCT-II → keep top-left 8×8 low frequencies
 *   → threshold each coefficient against the mean (excluding the DC term) → 64 bits → hex.
 */

const IMAGE_SIZE = 32; // DCT input resolution
const HASH_SIZE = 8; // low-frequency block kept => 8*8 = 64 bits

/**
 * Down/up-samples an arbitrary-size grayscale image to IMAGE_SIZE×IMAGE_SIZE using
 * simple box averaging. `gray[y * width + x]` in [0, 255].
 */
function resizeToSquare(gray: ArrayLike<number>, width: number, height: number): number[] {
  const out = new Array<number>(IMAGE_SIZE * IMAGE_SIZE);
  for (let ty = 0; ty < IMAGE_SIZE; ty++) {
    const y0 = Math.floor((ty * height) / IMAGE_SIZE);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / IMAGE_SIZE));
    for (let tx = 0; tx < IMAGE_SIZE; tx++) {
      const x0 = Math.floor((tx * width) / IMAGE_SIZE);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / IMAGE_SIZE));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += gray[y * width + x];
          count++;
        }
      }
      out[ty * IMAGE_SIZE + tx] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

// Precomputed DCT-II cosine table: cos[k][n] = cos((2n+1) k π / 2N), k in [0,HASH_SIZE), n in [0,IMAGE_SIZE).
// We only need the first HASH_SIZE output frequencies, so the table is small.
const COS_TABLE: number[][] = (() => {
  const table: number[][] = [];
  for (let k = 0; k < HASH_SIZE; k++) {
    const row = new Array<number>(IMAGE_SIZE);
    for (let n = 0; n < IMAGE_SIZE; n++) {
      row[n] = Math.cos(((2 * n + 1) * k * Math.PI) / (2 * IMAGE_SIZE));
    }
    table[k] = row;
  }
  return table;
})();

/**
 * Computes the top-left HASH_SIZE×HASH_SIZE block of the 2D DCT-II of a 32×32 image.
 * Scale factors are dropped — we only compare coefficients to their own mean, so any
 * constant normalization cancels out. Separable: rows first, then columns.
 */
function dctLowFrequencies(square: number[]): number[] {
  // temp[u][y] = sum_x f(x,y) * cos[u][x]
  const temp: number[][] = [];
  for (let u = 0; u < HASH_SIZE; u++) {
    const cosU = COS_TABLE[u];
    const row = new Array<number>(IMAGE_SIZE).fill(0);
    for (let y = 0; y < IMAGE_SIZE; y++) {
      let acc = 0;
      for (let x = 0; x < IMAGE_SIZE; x++) {
        acc += square[y * IMAGE_SIZE + x] * cosU[x];
      }
      row[y] = acc;
    }
    temp[u] = row;
  }
  // F[u][v] = sum_y temp[u][y] * cos[v][y]
  const block = new Array<number>(HASH_SIZE * HASH_SIZE);
  for (let u = 0; u < HASH_SIZE; u++) {
    for (let v = 0; v < HASH_SIZE; v++) {
      const cosV = COS_TABLE[v];
      let acc = 0;
      for (let y = 0; y < IMAGE_SIZE; y++) {
        acc += temp[u][y] * cosV[y];
      }
      block[u * HASH_SIZE + v] = acc;
    }
  }
  return block;
}

/**
 * Converts interleaved RGBA bytes to a grayscale luma array (Rec. 601).
 * `rgba` length must be width*height*4.
 */
export function rgbaToGrayscale(
  rgba: ArrayLike<number>,
  width: number,
  height: number
): number[] {
  const gray = new Array<number>(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return gray;
}

/**
 * Computes the 64-bit perceptual hash of a grayscale image, returned as 16 hex chars.
 * `gray[y * width + x]` in [0, 255].
 */
export function pHashFromGrayscale(
  gray: ArrayLike<number>,
  width: number,
  height: number
): string {
  const square = resizeToSquare(gray, width, height);
  const block = dctLowFrequencies(square);

  // Mean of the 64 coefficients EXCLUDING the DC term (block[0]) — the DC term carries
  // overall brightness and would swamp the threshold.
  let sum = 0;
  for (let i = 1; i < block.length; i++) sum += block[i];
  const mean = sum / (block.length - 1);

  // Build 64 bits MSB-first, pack into a 16-char hex string.
  let hex = "";
  for (let nibble = 0; nibble < 16; nibble++) {
    let value = 0;
    for (let bit = 0; bit < 4; bit++) {
      const i = nibble * 4 + bit;
      value = (value << 1) | (block[i] > mean ? 1 : 0);
    }
    hex += value.toString(16);
  }
  return hex;
}

/** RGBA convenience wrapper around {@link pHashFromGrayscale}. */
export function pHashFromRgba(
  rgba: ArrayLike<number>,
  width: number,
  height: number
): string {
  return pHashFromGrayscale(rgbaToGrayscale(rgba, width, height), width, height);
}

const POPCOUNT_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/**
 * Hamming distance (number of differing bits, 0–64) between two 16-char hex pHashes.
 * This is the AMBER decision metric — compare against the threshold measured by the
 * Instagram round-trip experiment (see docs/ROADMAP.md, Rung 2).
 */
export function hammingDistanceHex(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error(`pHash length mismatch: ${a.length} vs ${b.length}`);
  }
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    distance += POPCOUNT_NIBBLE[xor];
  }
  return distance;
}

// ---------------------------------------------------------------------------
// Platform pixel extraction
// ---------------------------------------------------------------------------
// The pure core above needs grayscale pixels. Getting them differs per platform:
//
//   • Verifier BACKEND (Node): decode with `sharp`:
//       const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
//       const hash = pHashFromRgba(data, info.width, info.height);   // info.channels may be 3 or 4
//
//   • WEB (Expo web / verifier site): use <canvas> + getImageData — see pHashFromImageUriWeb below.
//
//   • Native capture (iOS/Android): Expo has no direct raw-pixel API. Path: resize with
//     expo-image-manipulator to 32×32 PNG → decode the PNG bytes in JS → pHashFromRgba.
//     Deferred until the capture device needs to sign the pHash into the manifest; the
//     backend can compute it in the meantime. Tracked in lib/CLAUDE.md.

/**
 * Web-only: loads an image URL/URI into a canvas and returns its pHash.
 * Throws if no DOM canvas is available (i.e. on native). Uses `any` for DOM globals so
 * this file stays dependency-free and compiles in the RN toolchain.
 */
export async function pHashFromImageUriWeb(uri: string): Promise<string> {
  const g = globalThis as any;
  if (typeof g.document === "undefined") {
    throw new Error("pHashFromImageUriWeb is only available on web.");
  }
  const img: any = await new Promise((resolve, reject) => {
    const el = new g.Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = uri;
  });
  const canvas = g.document.createElement("canvas");
  canvas.width = IMAGE_SIZE;
  canvas.height = IMAGE_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
  const { data } = ctx.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE);
  return pHashFromRgba(data, IMAGE_SIZE, IMAGE_SIZE);
}
