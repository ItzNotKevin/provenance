/**
 * Pure verdict-building logic for the client verify path (lib/solana.ts). No
 * react-native or web3.js imports — same rule as lib/manifest.ts — so the exact
 * code that runs on device also runs under `node --test` (tests/verdict.test.ts).
 *
 * The iron rule (lib/CLAUDE.md) shapes everything here: anything malformed or
 * unexpected maps to "no verdict" (null), never to a fabricated match.
 */
import type { AttestationRecord, Verdict } from "./registry";

/** Formats unix seconds as "YYYY-MM-DD HH:MM:SS UTC", matching the rest of the app. */
export function formatUnixSeconds(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/** "3f2a…9b0c" — the display form used for keys and tx signatures across the app. */
export function truncateKey(hex: string): string {
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

export interface DecodedAttestation {
  sha256: Uint8Array;
  phash: bigint;
  devicePubkey: Uint8Array;
  timestamp: number;
  slot: bigint;
}

/**
 * Decodes a PhotoAttestation account. MUST mirror the field order in
 * program/programs/provenance/src/lib.rs:
 *
 *   discriminator (8) ‖ sha256 (32) ‖ phash u64 LE (8) ‖ device_pubkey (32) ‖
 *   timestamp i64 LE (8) ‖ parent_hash Option<[u8;32]> (1 or 33) ‖ slot u64 LE (8)
 *
 * Throws (RangeError) on a truncated buffer — callers treat decode failure as GREY.
 */
export function decodePhotoAttestation(data: Uint8Array): DecodedAttestation {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8; // 8-byte Anchor account discriminator
  const sha256 = data.slice(o, o + 32);
  o += 32;
  const phash = view.getBigUint64(o, true);
  o += 8;
  const devicePubkey = data.slice(o, o + 32);
  o += 32;
  const timestamp = Number(view.getBigInt64(o, true));
  o += 8;
  const hasParent = view.getUint8(o) === 1;
  o += 1;
  if (hasParent) o += 32; // parent_hash: not surfaced yet, skip past it
  const slot = view.getBigUint64(o, true);
  return { sha256, phash, devicePubkey, timestamp, slot };
}

/**
 * Maps a backend `POST /verify` response body (untrusted network JSON) to an AMBER
 * Verdict, or null for anything else. Deliberately narrow:
 * - GREEN is never taken from the backend — the client's own direct chain read is
 *   the sole source of green (lib/solana.ts), so a backend "green" here maps to null.
 * - Any missing or wrong-typed field maps to null (→ GREY upstream) rather than a
 *   partially-populated verdict card.
 */
export function amberVerdictFromVerifyResponse(body: unknown): Verdict | null {
  if (typeof body !== "object" || body === null) return null;
  const { tier, record, hammingDistance } = body as {
    tier?: unknown;
    record?: unknown;
    hammingDistance?: unknown;
  };
  if (tier !== "amber") return null;
  if (typeof record !== "object" || record === null) return null;
  const { sha256, devicePubkey, timestamp, explorerUrl } = record as {
    sha256?: unknown;
    devicePubkey?: unknown;
    timestamp?: unknown;
    explorerUrl?: unknown;
  };
  if (typeof sha256 !== "string" || typeof devicePubkey !== "string") return null;
  if (typeof timestamp !== "number" || typeof explorerUrl !== "string") return null;

  const attested: AttestationRecord = {
    sha256,
    capturedAt: formatUnixSeconds(timestamp),
    devicePubkey: truncateKey(devicePubkey),
    // The backend confirms candidates via the PDA (address), not a tx lookup, so no
    // tx signature is available here; explorerUrl points at the on-chain account.
    txSignature: "unknown",
    explorerUrl,
  };
  return {
    tier: "amber",
    record: attested,
    hammingDistance: typeof hammingDistance === "number" ? hammingDistance : undefined,
  };
}
