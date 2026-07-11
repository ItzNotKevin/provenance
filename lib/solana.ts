/**
 * Real devnet read path for the provenance program (see program/README.md).
 *
 * Writes (attest_photo) go through the backend (backend/src/chain.ts), which owns the
 * fee-payer key server-side. Reads need no signing key, so it's safe to hit the public
 * devnet RPC directly from the client — this is what makes GREEN a pure, unforgeable
 * chain read with no database in the loop (see lib/CLAUDE.md).
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { hexToBytes, bytesToHex } from "@/lib/manifest";
import { PROGRAM_ID, DEVNET_RPC_URL, CLUSTER_QUERY } from "@/lib/solanaConfig";
import type { AttestationRecord, Verdict } from "@/lib/registry";

const programId = new PublicKey(PROGRAM_ID);

let connection: Connection | null = null;
function getConnection(): Connection {
  if (!connection) connection = new Connection(DEVNET_RPC_URL, "confirmed");
  return connection;
}

function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${CLUSTER_QUERY}`;
}

/** Formats unix seconds as "YYYY-MM-DD HH:MM:SS UTC", matching the rest of the app. */
export function formatUnixSeconds(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function deriveAttestationPda(sha256: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("photo"), sha256],
    programId
  );
  return pda;
}

interface DecodedAttestation {
  sha256: Uint8Array;
  phash: bigint;
  devicePubkey: Uint8Array;
  timestamp: number;
  slot: bigint;
}

/** Mirrors PhotoAttestation's field order in program/programs/provenance/src/lib.rs. */
function decodePhotoAttestation(data: Buffer): DecodedAttestation {
  let o = 8; // 8-byte Anchor account discriminator
  const sha256 = new Uint8Array(data.subarray(o, o + 32));
  o += 32;
  const phash = data.readBigUInt64LE(o);
  o += 8;
  const devicePubkey = new Uint8Array(data.subarray(o, o + 32));
  o += 32;
  const timestamp = Number(data.readBigInt64LE(o));
  o += 8;
  const hasParent = data.readUInt8(o) === 1;
  o += 1;
  if (hasParent) o += 32; // parent_hash: not surfaced yet, skip past it
  const slot = data.readBigUInt64LE(o);
  return { sha256, phash, devicePubkey, timestamp, slot };
}

/**
 * Reads the on-chain PDA for this hash. GREEN if it exists (pure chain read,
 * unforgeable), GREY if it doesn't. Never a judgment beyond "found" / "not found".
 */
export async function realLookupHash(sha256Hex: string): Promise<Verdict> {
  const conn = getConnection();
  const sha256 = hexToBytes(sha256Hex);
  const pda = deriveAttestationPda(sha256);

  const account = await conn.getAccountInfo(pda, "confirmed");
  if (!account) return { tier: "grey" };

  const decoded = decodePhotoAttestation(account.data);

  const signatures = await conn.getSignaturesForAddress(pda, { limit: 1 });
  const txSignature = signatures[0]?.signature ?? "unknown";

  const devicePubkeyHex = bytesToHex(decoded.devicePubkey);
  const record: AttestationRecord = {
    sha256: bytesToHex(decoded.sha256),
    capturedAt: formatUnixSeconds(decoded.timestamp),
    devicePubkey: devicePubkeyHex.slice(0, 4) + "…" + devicePubkeyHex.slice(-4),
    txSignature: txSignature === "unknown" ? "unknown" : txSignature.slice(0, 4) + "…" + txSignature.slice(-4),
    explorerUrl: txSignature === "unknown" ? explorerTxUrl(pda.toBase58()) : explorerTxUrl(txSignature),
  };

  return { tier: "green", record };
}
