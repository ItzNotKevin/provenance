import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import anchor from "@coral-xyz/anchor";
import nacl from "tweetnacl";
import { canonicalManifestBytes, hexToBytes } from "../../lib/manifest.ts";
import { RPC_URL, loadFeePayer } from "./config.ts";

const { web3, BN, AnchorProvider, Program, Wallet } = anchor;
const { PublicKey, Connection, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, Ed25519Program } = web3;

const IDL_PATH = fileURLToPath(
  new URL("../../program/target/idl/provenance.json", import.meta.url)
);

export class InvalidSignatureError extends Error {}
export class DuplicateAttestationError extends Error {}

let programSingleton: InstanceType<typeof Program> | null = null;

function getProgram(): InstanceType<typeof Program> {
  if (programSingleton) return programSingleton;

  let idl: unknown;
  try {
    idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
  } catch (err) {
    throw new Error(
      `Couldn't read the program IDL at ${IDL_PATH}. Build it first: ` +
        `cd program && ./build.sh (see program/README.md). (${(err as Error).message})`
    );
  }

  const feePayer = loadFeePayer();
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(feePayer), {
    commitment: "confirmed",
  });
  programSingleton = new Program(idl as anchor.Idl, provider);
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

  const [attestationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("photo"), Buffer.from(sha256)],
    program.programId
  );

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
