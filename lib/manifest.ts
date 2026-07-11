/**
 * Canonical signed-message format — the single source of truth for the bytes the device
 * signs and the on-chain program verifies. Pure (no react-native imports) so it runs on
 * device, in the backend, and in tests.
 *
 * MUST stay byte-identical to `canonical_message` in
 * program/programs/provenance/src/lib.rs:
 *
 *   message = sha256 (32 bytes) ‖ timestamp_i64_LE (8 bytes) ‖ device_pubkey (32 bytes)   // 72 bytes
 *
 * NOTE: the capture app currently signs `JSON.stringify(manifest)` (see
 * app/(tabs)/capture.tsx → signManifest). Switching it to sign `canonicalManifestBytes(...)`
 * is the last app↔chain gap before real capture verifies on-chain.
 */

export const CANONICAL_MESSAGE_LEN = 72;

/** Parses a hex string into bytes. Throws on odd length or non-hex characters. */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`hex length must be even, got ${hex.length}`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`invalid hex at offset ${i * 2}`);
    out[i] = byte;
  }
  return out;
}

/** Encodes bytes as a lowercase hex string. */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Builds the canonical signed message from a photo's SHA-256 (hex), capture time (unix
 * seconds), and device Ed25519 public key (hex). Returns exactly 72 bytes.
 */
export function canonicalManifestBytes(
  sha256Hex: string,
  unixSeconds: number,
  devicePubkeyHex: string
): Uint8Array {
  const sha = hexToBytes(sha256Hex);
  const pubkey = hexToBytes(devicePubkeyHex);
  if (sha.length !== 32) throw new Error(`sha256 must be 32 bytes, got ${sha.length}`);
  if (pubkey.length !== 32) throw new Error(`device pubkey must be 32 bytes, got ${pubkey.length}`);
  if (!Number.isInteger(unixSeconds)) throw new Error("unixSeconds must be an integer");

  const out = new Uint8Array(CANONICAL_MESSAGE_LEN);
  out.set(sha, 0);
  new DataView(out.buffer).setBigInt64(32, BigInt(unixSeconds), true /* little-endian */);
  out.set(pubkey, 40);
  return out;
}
