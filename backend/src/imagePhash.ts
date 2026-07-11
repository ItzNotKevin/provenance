import sharp from "sharp";
import { pHashFromRgba } from "../../lib/phash.ts";

export class ImageDecodeError extends Error {}

/**
 * Decodes JPEG/PNG/etc bytes and computes their canonical 16-char hex pHash (see
 * lib/phash.ts). This is the v1 architecture decision from lib/CLAUDE.md: pHash is computed
 * server-side from the uploaded image at ingest, not device-signed, because Expo native has
 * no cheap raw-pixel API. Safe because pHash only ever drives the evidence-only AMBER tier,
 * and every AMBER candidate is re-confirmed against the device-signed SHA-256 before display
 * — an unsigned/backend-computed pHash can never produce a false "verified".
 *
 * `.ensureAlpha()` guarantees 4 interleaved channels regardless of the source format, matching
 * pHashFromRgba's RGBA indexing assumption (it reads i*4, i*4+1, i*4+2 and ignores alpha).
 */
export async function computePhashFromImageBytes(bytes: Buffer): Promise<string> {
  try {
    const { data, info } = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return pHashFromRgba(data, info.width, info.height);
  } catch (err) {
    throw new ImageDecodeError(`could not decode image: ${(err as Error).message}`);
  }
}
