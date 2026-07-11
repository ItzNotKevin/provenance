import { createHash } from "node:crypto";
import anchor from "@coral-xyz/anchor";
import { bytesToHex, hexToBytes } from "../../lib/manifest.ts";
import { PROGRAM_ID } from "../../lib/solanaConfig.ts";
import { RPC_URL } from "./config.ts";
import { phashToHex } from "./chain.ts";

const { web3 } = anchor;
const { Connection, PublicKey } = web3;

const programId = new PublicKey(PROGRAM_ID);
const accountDiscriminator = createHash("sha256")
  .update("account:PhotoAttestation")
  .digest()
  .subarray(0, 8);

let connection: InstanceType<typeof Connection> | null = null;

function getConnection(): InstanceType<typeof Connection> {
  if (!connection) connection = new Connection(RPC_URL, "confirmed");
  return connection;
}

export class InvalidHashError extends Error {}
export class InvalidAttestationAccountError extends Error {}

export interface LookupAccountInfo {
  data: Buffer;
  owner: InstanceType<typeof PublicKey>;
}

export type FetchLookupAccount = (
  pda: InstanceType<typeof PublicKey>
) => Promise<LookupAccountInfo | null>;

async function fetchLookupAccount(
  pda: InstanceType<typeof PublicKey>
): Promise<LookupAccountInfo | null> {
  return getConnection().getAccountInfo(pda, "confirmed");
}

export interface ChainAttestationRecord {
  sha256: string;
  /** 16-char hex, canonical format — same as lib/phash.ts (Hamming distance, vector search). */
  phash: string;
  devicePubkey: string;
  timestamp: number;
  parentHash: string | null;
  slot: string;
  pda: string;
  explorerUrl: string;
}

export function normalizeSha256(sha256Hex: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(sha256Hex)) {
    throw new InvalidHashError("sha256 must be exactly 64 hexadecimal characters");
  }
  return sha256Hex.toLowerCase();
}

export function deriveAttestationPda(sha256Hex: string): InstanceType<typeof PublicKey> {
  const sha256 = hexToBytes(normalizeSha256(sha256Hex));
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("photo"), Buffer.from(sha256)],
    programId
  );
  return pda;
}

function requireBytes(data: Buffer, offset: number, length: number): void {
  if (offset + length > data.length) {
    throw new InvalidAttestationAccountError("attestation account data is truncated");
  }
}

/**
 * Decodes a raw PhotoAttestation account buffer. Pure (no network) — exported so
 * scripts/reindex.ts can decode accounts it already has bytes for (from getProgramAccounts)
 * without a redundant lookupAttestation RPC round-trip per account.
 */
export function decodeAttestation(data: Buffer): Omit<ChainAttestationRecord, "pda" | "explorerUrl"> {
  requireBytes(data, 0, 8);
  if (!data.subarray(0, 8).equals(accountDiscriminator)) {
    throw new InvalidAttestationAccountError("account discriminator is not PhotoAttestation");
  }

  let offset = 8;
  const readBytes = (length: number): Buffer => {
    requireBytes(data, offset, length);
    const value = data.subarray(offset, offset + length);
    offset += length;
    return value;
  };

  const sha256 = bytesToHex(readBytes(32));
  // Canonical 16-char hex (see lib/phash.ts) — not decimal — so this matches the format
  // Hamming distance / vector search (backend/src/phashVector.ts) expect everywhere else.
  const phash = phashToHex(readBytes(8).readBigUInt64LE());
  const devicePubkey = new PublicKey(readBytes(32)).toBase58();
  const timestampBigInt = readBytes(8).readBigInt64LE();
  if (
    timestampBigInt < BigInt(Number.MIN_SAFE_INTEGER) ||
    timestampBigInt > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new InvalidAttestationAccountError("attestation timestamp is outside the safe integer range");
  }

  const parentTag = readBytes(1)[0];
  if (parentTag !== 0 && parentTag !== 1) {
    throw new InvalidAttestationAccountError("attestation parent_hash option is malformed");
  }
  const parentHash = parentTag === 1 ? bytesToHex(readBytes(32)) : null;
  const slot = readBytes(8).readBigUInt64LE().toString();
  readBytes(1); // bump

  return {
    sha256,
    phash,
    devicePubkey,
    timestamp: Number(timestampBigInt),
    parentHash,
    slot,
  };
}

/**
 * Reads the hash-derived PhotoAttestation PDA directly from Solana. This path has no
 * database or fee-payer dependency: a returned record is backed only by program-owned
 * account data, and a missing account is a normal no-match result.
 */
export async function lookupAttestation(
  sha256Hex: string,
  fetchAccount: FetchLookupAccount = fetchLookupAccount
): Promise<ChainAttestationRecord | null> {
  const normalizedHash = normalizeSha256(sha256Hex);
  const pda = deriveAttestationPda(normalizedHash);
  const account = await fetchAccount(pda);
  if (!account) return null;

  if (!account.owner.equals(programId)) {
    throw new InvalidAttestationAccountError("attestation PDA is not owned by the provenance program");
  }

  const decoded = decodeAttestation(account.data);
  if (decoded.sha256 !== normalizedHash) {
    throw new InvalidAttestationAccountError("attestation account hash does not match its PDA seed");
  }

  return {
    ...decoded,
    pda: pda.toBase58(),
    explorerUrl: `https://explorer.solana.com/address/${pda.toBase58()}?cluster=devnet`,
  };
}
