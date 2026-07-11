/**
 * Real devnet chain calls for the provenance program (see program/README.md).
 *
 * Hand-rolls the Anchor instruction/account encoding instead of pulling in
 * @coral-xyz/anchor client-side — its IDL/BN machinery is heavier and less
 * predictable under Metro/Hermes than a few dozen lines of manual Borsh packing.
 * The byte layout here was validated against devnet via transaction simulation
 * (see program/validate.mjs) before being ported in.
 *
 * Scope: GREEN (exact on-chain match) and GREY (no match) only. AMBER needs the
 * pHash backend + Mongo described in lib/CLAUDE.md and isn't wired yet.
 */
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Ed25519Program,
} from "@solana/web3.js";
import * as Crypto from "expo-crypto";
import { hexToBytes, bytesToHex, canonicalManifestBytes } from "@/lib/manifest";
import {
  PROGRAM_ID,
  DEVNET_RPC_URL,
  CLUSTER_QUERY,
  FEE_PAYER_SECRET_KEY,
} from "@/lib/solanaConfig";
import type { AttestationRecord, CaptureManifest, Verdict } from "@/lib/registry";

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

function u64LE(n: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n, true);
  return out;
}

function i64LE(n: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, BigInt(n), true);
  return out;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Anchor discriminators are sha256("<namespace>:<name>") truncated to 8 bytes. */
async function anchorDiscriminator(preimage: string): Promise<Uint8Array> {
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    new TextEncoder().encode(preimage) as unknown as ArrayBuffer
  );
  return new Uint8Array(digest).subarray(0, 8);
}

/** Mirrors gen-idl.mjs / program/programs/provenance/src/lib.rs attest_photo args exactly. */
async function encodeAttestPhotoArgs(
  sha256: Uint8Array,
  phash: bigint,
  timestamp: number,
  parentHash: Uint8Array | null
): Promise<Uint8Array> {
  const disc = await anchorDiscriminator("global:attest_photo");
  const parts = [disc, sha256, u64LE(phash), i64LE(timestamp), new Uint8Array([parentHash ? 1 : 0])];
  if (parentHash) parts.push(parentHash);
  return concatBytes(parts);
}

function deriveAttestationPda(sha256: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("photo"), sha256],
    programId
  );
  return pda;
}

/**
 * Submits a signed capture manifest as a two-instruction devnet transaction:
 * a native Ed25519 precompile verify (over the exact canonical bytes the device
 * signed) followed by attest_photo, which introspects that verify on-chain.
 */
export async function realAttestPhoto(
  manifest: CaptureManifest,
  signatureHex: string
): Promise<{ txSignature: string; explorerUrl: string }> {
  const conn = getConnection();
  const feePayer = Keypair.fromSecretKey(FEE_PAYER_SECRET_KEY);

  const sha256 = hexToBytes(manifest.sha256);
  const devicePubkeyBytes = hexToBytes(manifest.devicePubkey);
  const signature = hexToBytes(signatureHex);
  const message = canonicalManifestBytes(manifest.sha256, manifest.timestamp, manifest.devicePubkey);

  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: devicePubkeyBytes,
    message,
    signature,
  });

  const attestationPda = deriveAttestationPda(sha256);
  const data = await encodeAttestPhotoArgs(sha256, 0n, manifest.timestamp, null);

  const attestIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: attestationPda, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(devicePubkeyBytes), isSigner: false, isWritable: false },
      { pubkey: feePayer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  const tx = new Transaction().add(ed25519Ix, attestIx);
  tx.feePayer = feePayer.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.sign(feePayer);

  const txSignature = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight }, "confirmed");

  return { txSignature, explorerUrl: explorerTxUrl(txSignature) };
}

interface DecodedAttestation {
  sha256: Uint8Array;
  phash: bigint;
  devicePubkey: Uint8Array;
  timestamp: number;
  slot: bigint;
}

function decodePhotoAttestation(data: Buffer): DecodedAttestation {
  // 8-byte Anchor account discriminator, then fields in struct declaration order.
  let o = 8;
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

  const record: AttestationRecord = {
    sha256: bytesToHex(decoded.sha256),
    capturedAt: formatUnixSeconds(decoded.timestamp),
    devicePubkey: bytesToHex(decoded.devicePubkey).slice(0, 4) + "…" + bytesToHex(decoded.devicePubkey).slice(-4),
    txSignature: txSignature === "unknown" ? "unknown" : txSignature.slice(0, 4) + "…" + txSignature.slice(-4),
    explorerUrl: txSignature === "unknown" ? explorerTxUrl(pda.toBase58()) : explorerTxUrl(txSignature),
  };

  return { tier: "green", record };
}
