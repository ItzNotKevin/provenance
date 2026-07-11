import {
  Connection, PublicKey, Keypair, SystemProgram, Transaction,
  TransactionInstruction, SYSVAR_INSTRUCTIONS_PUBKEY, Ed25519Program,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import { createHash, randomBytes } from "node:crypto";

const PROGRAM_ID = new PublicKey("EoWdDXF8NNnHryWFmnJazobruBvHPhZhKRR7YfrWjZ8g");
const DEVNET = "https://api.devnet.solana.com";

function disc(s) {
  return createHash("sha256").update(s).digest().subarray(0, 8);
}

function i64LE(n) {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(n));
  return b;
}
function u64LE(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

// Hand-rolled attest_photo instruction data (mirrors gen-idl.mjs / lib.rs exactly).
function encodeAttestPhotoArgs(sha256, phash, timestamp, parentHash) {
  const parts = [
    disc("global:attest_photo"),
    Buffer.from(sha256),
    u64LE(phash),
    i64LE(timestamp),
    parentHash ? Buffer.from([1]) : Buffer.from([0]),
  ];
  if (parentHash) parts.push(Buffer.from(parentHash));
  return Buffer.concat(parts);
}

async function main() {
  const connection = new Connection(DEVNET, "confirmed");

  // fee payer: our (currently unfunded) demo keypair
  const feePayerSecret = Uint8Array.from([147,170,215,28,232,46,230,220,99,21,108,73,122,221,24,89,96,24,206,105,113,209,243,167,123,248,27,60,154,183,127,28,72,152,69,43,242,63,251,217,1,202,157,251,104,101,220,72,204,129,134,160,9,226,186,165,42,126,32,48,115,14,68,70]);
  const feePayer = Keypair.fromSecretKey(feePayerSecret);

  // device identity (stand-in)
  const device = nacl.sign.keyPair();
  const devicePubkey = new PublicKey(device.publicKey);

  const sha256 = new Uint8Array(randomBytes(32));
  const timestamp = Math.floor(Date.now() / 1000);
  const message = Buffer.concat([Buffer.from(sha256), i64LE(timestamp), Buffer.from(device.publicKey)]);
  const signature = nacl.sign.detached(message, device.secretKey);

  console.log("message length (want 72):", message.length);

  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: device.publicKey,
    message,
    signature,
  });

  const [attestationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("photo"), Buffer.from(sha256)],
    PROGRAM_ID
  );
  console.log("derived PDA:", attestationPda.toBase58());

  const data = encodeAttestPhotoArgs(sha256, 0, timestamp, null);
  console.log("attest_photo ix data length:", data.length, "(want 57)");
  console.log("discriminator:", Array.from(data.subarray(0, 8)));

  const attestIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: attestationPda, isSigner: false, isWritable: true },
      { pubkey: devicePubkey, isSigner: false, isWritable: false },
      { pubkey: feePayer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ed25519Ix, attestIx);
  tx.feePayer = feePayer.publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.sign(feePayer);

  console.log("\n--- simulating (no funds needed to test encoding) ---");
  const sim = await connection.simulateTransaction(tx);
  console.log("simulation err:", JSON.stringify(sim.value.err));
  console.log("logs:");
  (sim.value.logs || []).forEach((l) => console.log("  " + l));
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
