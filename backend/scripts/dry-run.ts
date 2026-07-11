/**
 * Simulates (does not submit) a devnet attest_photo transaction against the real deployed
 * program. Useful for sanity-checking IDL/account layout without a funded fee payer.
 * Run: node scripts/dry-run.ts
 */
import { readFileSync } from "node:fs";
import nacl from "tweetnacl";
import anchor from "@coral-xyz/anchor";
import { canonicalManifestBytes, bytesToHex } from "../../lib/manifest.ts";
import { loadFeePayer, RPC_URL } from "../src/config.ts";

const { web3, BN, AnchorProvider, Program, Wallet } = anchor;
const { PublicKey, Connection, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, Ed25519Program } = web3;

const idl = JSON.parse(
  readFileSync(new URL("../../program/target/idl/provenance.json", import.meta.url), "utf8")
);
const feePayer = loadFeePayer();

const connection = new Connection(RPC_URL, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(feePayer), { commitment: "confirmed" });
const program = new Program(idl, provider);
console.log("program id:", program.programId.toBase58());
console.log("fee payer:", feePayer.publicKey.toBase58());

const device = nacl.sign.keyPair();
const sha256 = Uint8Array.from({ length: 32 }, (_, i) => i);
const sha256Hex = bytesToHex(sha256);
const timestamp = Math.floor(Date.now() / 1000);
const devicePubkeyHex = bytesToHex(device.publicKey);

const message = canonicalManifestBytes(sha256Hex, timestamp, devicePubkeyHex);
const signature = nacl.sign.detached(message, device.secretKey);
console.log("signature valid:", nacl.sign.detached.verify(message, signature, device.publicKey));

const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
  publicKey: device.publicKey,
  message,
  signature,
});

const [attestationPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("photo"), Buffer.from(sha256)],
  program.programId
);
console.log("derived PDA:", attestationPda.toBase58());

const tx = await program.methods
  .attestPhoto(Array.from(sha256), new BN(0), new BN(timestamp), null)
  .accountsPartial({
    attestation: attestationPda,
    device: new PublicKey(device.publicKey),
    feePayer: feePayer.publicKey,
    instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    systemProgram: SystemProgram.programId,
  })
  .preInstructions([ed25519Ix])
  .transaction();

tx.feePayer = feePayer.publicKey;
tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

const sim = await connection.simulateTransaction(tx, [feePayer]);
console.log("\n--- simulation result ---");
console.log("err:", JSON.stringify(sim.value.err));
console.log("logs:\n" + (sim.value.logs ?? []).join("\n"));
