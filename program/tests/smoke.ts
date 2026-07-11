/**
 * Devnet smoke test for the provenance program — run: `npm run smoke` (from program/).
 *
 * Proves the whole on-chain pipeline end-to-end:
 *   1. generate a device Ed25519 keypair (stands in for the phone)
 *   2. build the canonical signed message  sha256(32) ‖ timestamp_i64LE(8) ‖ devicePubkey(32)
 *   3. sign it with tweetnacl (as the app's signManifest will)
 *   4. submit ONE transaction with TWO instructions: Ed25519 precompile verify + attest_photo
 *   5. read the PhotoAttestation PDA back and assert the fields match
 *
 * If this passes, the fiddly ed25519-sysvar introspection in the program works and the
 * GREEN spine is real. Prints the explorer URL for the attestation tx.
 */
import anchor from "@coral-xyz/anchor";
import nacl from "tweetnacl";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

const { web3, BN } = anchor;
const { PublicKey, Keypair, Connection, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, Ed25519Program } =
  web3;

const DEVNET = "https://api.devnet.solana.com";

function i64ToLE(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(n));
  return b;
}

function loadWallet(): InstanceType<typeof Keypair> {
  const path = `${homedir()}/.config/solana/id.json`;
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
  return Keypair.fromSecretKey(secret);
}

async function main() {
  const idl = JSON.parse(
    readFileSync(new URL("../target/idl/provenance.json", import.meta.url), "utf8")
  );

  const walletKp = loadWallet();
  const connection = new Connection(DEVNET, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(walletKp), {
    commitment: "confirmed",
  });
  const program = new anchor.Program(idl, provider);
  console.log(`program: ${program.programId.toBase58()}`);
  console.log(`fee payer: ${walletKp.publicKey.toBase58()}`);

  // 1. device identity (the phone's Ed25519 key = also a valid Solana pubkey)
  const device = nacl.sign.keyPair();
  const devicePubkey = new PublicKey(device.publicKey);

  // 2 + 3. canonical message + device signature
  const sha256 = new Uint8Array(randomBytes(32));
  const phash = new BN("1234567890123456"); // stand-in u64 pHash
  const timestamp = Math.floor(Date.now() / 1000);
  const message = Buffer.concat([
    Buffer.from(sha256),
    i64ToLE(timestamp),
    Buffer.from(device.publicKey),
  ]);
  const signature = nacl.sign.detached(message, device.secretKey);

  // 4. two-instruction transaction
  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: device.publicKey,
    message,
    signature,
  });

  const [attestationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("photo"), Buffer.from(sha256)],
    program.programId
  );

  const txSig = await program.methods
    .attestPhoto(Array.from(sha256), phash, new BN(timestamp), null)
    .accountsPartial({
      attestation: attestationPda,
      device: devicePubkey,
      feePayer: walletKp.publicKey,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([ed25519Ix])
    .rpc();

  console.log(`\n✅ attested. tx: ${txSig}`);
  console.log(`   explorer: https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
  console.log(`   PDA:      ${attestationPda.toBase58()}`);

  // 5. read back + assert
  const record = await program.account.photoAttestation.fetch(attestationPda);
  const gotSha = Buffer.from(record.sha256).toString("hex");
  const wantSha = Buffer.from(sha256).toString("hex");
  const okSha = gotSha === wantSha;
  const okDevice = new PublicKey(record.devicePubkey).equals(devicePubkey);
  const okPhash = record.phash.eq(phash);
  const okTs = record.timestamp.toNumber() === timestamp;

  console.log("\n--- read-back assertions ---");
  console.log(`sha256 match:    ${okSha}`);
  console.log(`device match:    ${okDevice}`);
  console.log(`phash match:     ${okPhash}`);
  console.log(`timestamp match: ${okTs}`);
  console.log(`slot:            ${record.slot.toString()}`);

  // Duplicate rejection: re-submitting the same sha256 must fail (PDA already exists).
  let dupRejected = false;
  try {
    await program.methods
      .attestPhoto(Array.from(sha256), phash, new BN(timestamp), null)
      .accountsPartial({
        attestation: attestationPda,
        device: devicePubkey,
        feePayer: walletKp.publicKey,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ed25519Ix])
      .rpc();
  } catch {
    dupRejected = true;
  }
  console.log(`dup rejected:    ${dupRejected}`);

  const allOk = okSha && okDevice && okPhash && okTs && dupRejected;
  console.log(`\n${allOk ? "ALL PASS ✓" : "SOME FAILED ✗"}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
