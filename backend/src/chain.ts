import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import anchor from "@coral-xyz/anchor";
import nacl from "tweetnacl";
import { canonicalManifestBytes, hexToBytes, bytesToHex } from "../../lib/manifest.ts";
import { RPC_URL, loadFeePayer } from "./config.ts";

const { web3, BN, AnchorProvider, Program, Wallet } = anchor;
const { PublicKey, Connection, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, Ed25519Program } = web3;

const IDL_PATH = fileURLToPath(
  new URL("../../program/target/idl/provenance.json", import.meta.url)
);

export class InvalidSignatureError extends Error {}
export class DuplicateAttestationError extends Error {}

interface ProvenanceIdl {
  address: string;
  accounts?: { name: string; discriminator: number[] }[];
}

let idlSingleton: ProvenanceIdl | null = null;

function loadIdl(): ProvenanceIdl {
  if (idlSingleton) return idlSingleton;
  try {
    idlSingleton = JSON.parse(readFileSync(IDL_PATH, "utf8")) as ProvenanceIdl;
  } catch (err) {
    throw new Error(
      `Couldn't read the program IDL at ${IDL_PATH}. Generate it first: ` +
        `cd program && node scripts/gen-idl.mjs (or ./build.sh — see program/README.md). ` +
        `(${(err as Error).message})`
    );
  }
  return idlSingleton;
}

function getProgramId(): InstanceType<typeof PublicKey> {
  return new PublicKey(loadIdl().address);
}

/** Derives the attestation PDA for a photo's SHA-256, matching the on-chain seeds. */
function attestationPdaFor(sha256: Uint8Array): InstanceType<typeof PublicKey> {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("photo"), Buffer.from(sha256)],
    getProgramId()
  );
  return pda;
}

let programSingleton: InstanceType<typeof Program> | null = null;

function getProgram(): InstanceType<typeof Program> {
  if (programSingleton) return programSingleton;

  const feePayer = loadFeePayer();
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(feePayer), {
    commitment: "confirmed",
  });
  programSingleton = new Program(loadIdl() as unknown as anchor.Idl, provider);
  return programSingleton;
}

export interface AttestInput {
  /** hex-encoded 32-byte photo SHA-256 */
  sha256Hex: string;
  /** capture time, unix seconds */
  timestamp: number;
  /** hex-encoded 32-byte device Ed25519 public key */
  devicePubkeyHex: string;
  /** hex-encoded 64-byte Ed25519 signature over the canonical manifest bytes */
  signatureHex: string;
  /** perceptual hash computed at ingest (evidence-only, amber tier); 0 if not yet wired */
  phash?: bigint;
  /** hex-encoded 32-byte SHA-256 of the parent photo, for edit lineage */
  parentHashHex?: string | null;
}

export interface AttestResult {
  txSignature: string;
  explorerUrl: string;
  pda: string;
}

/**
 * Validates the device's Ed25519 signature over the canonical manifest, then submits the
 * two-instruction devnet transaction (Ed25519 precompile verify + attest_photo) as fee payer.
 * Mirrors program/tests/smoke.ts, parameterized for a real device-signed manifest.
 */
export async function submitAttestation(input: AttestInput): Promise<AttestResult> {
  const sha256 = hexToBytes(input.sha256Hex);
  const devicePubkeyBytes = hexToBytes(input.devicePubkeyHex);
  const signature = hexToBytes(input.signatureHex);
  if (sha256.length !== 32) throw new InvalidSignatureError("sha256 must be 32 bytes");
  if (devicePubkeyBytes.length !== 32) {
    throw new InvalidSignatureError("devicePubkey must be 32 bytes");
  }
  if (signature.length !== 64) throw new InvalidSignatureError("signature must be 64 bytes");

  const message = canonicalManifestBytes(input.sha256Hex, input.timestamp, input.devicePubkeyHex);
  const signatureOk = nacl.sign.detached.verify(message, signature, devicePubkeyBytes);
  if (!signatureOk) {
    throw new InvalidSignatureError(
      "Ed25519 signature does not match the canonical manifest bytes for this device key"
    );
  }

  const program = getProgram();
  const devicePubkey = new PublicKey(devicePubkeyBytes);
  const feePayer = (program.provider as InstanceType<typeof AnchorProvider>).wallet.publicKey;

  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: devicePubkeyBytes,
    message,
    signature,
  });

  const attestationPda = attestationPdaFor(sha256);

  const parentHash = input.parentHashHex ? Array.from(hexToBytes(input.parentHashHex)) : null;

  try {
    const txSignature = await program.methods
      .attestPhoto(Array.from(sha256), new BN((input.phash ?? 0n).toString()), new BN(input.timestamp), parentHash)
      .accountsPartial({
        attestation: attestationPda,
        device: devicePubkey,
        feePayer,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ed25519Ix])
      .rpc();

    return {
      txSignature,
      explorerUrl: `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`,
      pda: attestationPda.toBase58(),
    };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    if (/already in use/i.test(message)) {
      throw new DuplicateAttestationError(
        `An attestation for this photo already exists (PDA ${attestationPda.toBase58()})`
      );
    }
    throw err;
  }
}

/**
 * The decoded on-chain PhotoAttestation account. Every field here comes straight from a
 * confirmed chain read — this is the source of a GREEN verdict (see lib/CLAUDE.md's iron rule:
 * every displayed fact must trace to a confirmed PDA read).
 */
export interface OnChainAttestation {
  /** hex-encoded 32-byte photo SHA-256 */
  sha256: string;
  /** 16-char hex perceptual hash — same canonical format as lib/phash.ts; "0"-padded (all zero) if not set at ingest */
  phash: string;
  /** hex-encoded 32-byte device Ed25519 public key */
  devicePubkey: string;
  /** capture time, unix seconds */
  timestamp: number;
  /** hex-encoded 32-byte parent SHA-256 for edit lineage, or null */
  parentHash: string | null;
  /** slot the attestation was recorded at */
  slot: number;
  /** the PDA (base58) the account lives at */
  pda: string;
  /** explorer link to the on-chain account */
  explorerUrl: string;
}

/**
 * Converts the on-chain u64 phash into the app's canonical 16-char hex pHash — the same
 * format lib/phash.ts produces/consumes everywhere else (Hamming distance, vector encoding).
 * The numeric value round-trips losslessly through the u64; only the string encoding differs.
 */
export function phashToHex(phash: bigint): string {
  return phash.toString(16).padStart(16, "0");
}

/** Parses the app's canonical 16-char hex pHash into the u64 the chain stores. */
export function phashFromHex(hex: string): bigint {
  if (!/^[0-9a-fA-F]{16}$/.test(hex)) {
    throw new InvalidSignatureError(`phash must be 16 hex characters, got ${JSON.stringify(hex)}`);
  }
  return BigInt(`0x${hex}`);
}

// Anchor 8-byte account discriminator for PhotoAttestation (from the IDL).
function photoAttestationDiscriminator(): number[] {
  const acct = loadIdl().accounts?.find((a) => a.name === "PhotoAttestation");
  if (!acct) throw new Error("IDL is missing the PhotoAttestation account discriminator");
  return acct.discriminator;
}

/**
 * Decodes a raw PhotoAttestation account buffer. Pure (no network) so it's unit-testable.
 * Layout mirrors `PhotoAttestation` in program/programs/provenance/src/lib.rs and the
 * client-side decoder in lib/solana.ts — keep the three in sync:
 *   disc(8) ‖ sha256[32] ‖ phash u64 ‖ device_pubkey[32] ‖ timestamp i64 ‖
 *   parent_hash Option<[u8;32]>(1 tag +0/32) ‖ slot u64 ‖ bump u8
 */
export function decodePhotoAttestation(
  data: Buffer,
  pdaBase58: string
): OnChainAttestation {
  const disc = photoAttestationDiscriminator();
  if (data.length < 8 || disc.some((b, i) => data[i] !== b)) {
    throw new Error(`account at ${pdaBase58} is not a PhotoAttestation (unexpected discriminator)`);
  }

  let o = 8;
  const sha = data.subarray(o, o + 32); o += 32;
  const phash = data.readBigUInt64LE(o); o += 8;
  const device = data.subarray(o, o + 32); o += 32;
  const timestamp = data.readBigInt64LE(o); o += 8;
  const parentTag = data.readUInt8(o); o += 1;
  let parentHash: string | null = null;
  if (parentTag === 1) {
    parentHash = bytesToHex(data.subarray(o, o + 32));
    o += 32;
  }
  const slot = data.readBigUInt64LE(o);

  return {
    sha256: bytesToHex(sha),
    phash: phashToHex(phash),
    devicePubkey: bytesToHex(device),
    timestamp: Number(timestamp),
    parentHash,
    slot: Number(slot),
    pda: pdaBase58,
    explorerUrl: `https://explorer.solana.com/address/${pdaBase58}?cluster=devnet`,
  };
}

/**
 * GREEN-tier chain read: derive the PDA from the SHA-256 and read it directly from devnet.
 * Returns the decoded attestation if the account exists, or `null` if there's no match.
 * Read-only — needs no fee payer, signs nothing, spends nothing.
 */
export async function lookupAttestation(sha256Hex: string): Promise<OnChainAttestation | null> {
  const sha256 = hexToBytes(sha256Hex);
  if (sha256.length !== 32) throw new InvalidSignatureError("sha256 must be 32 bytes");

  const connection = new Connection(RPC_URL, "confirmed");
  const pda = attestationPdaFor(sha256);
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;

  return decodePhotoAttestation(info.data, pda.toBase58());
}
