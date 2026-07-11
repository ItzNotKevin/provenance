/**
 * Rebuilds the Mongo search index from scratch by scanning every PhotoAttestation account
 * on-chain (getProgramAccounts) — this is what makes "the index is fully rebuildable by
 * replaying the chain" (root CLAUDE.md) literally true, not just a claim. Safe to run anytime:
 * upserts by sha256, so it's idempotent and can run alongside the live write-through indexing
 * in src/server.ts without conflict.
 *
 * Run: node scripts/reindex.ts
 */
import { readFileSync } from "node:fs";
import anchor from "@coral-xyz/anchor";
import { RPC_URL } from "../src/config.ts";
import { decodePhotoAttestation } from "../src/chain.ts";
import { indexAttestation, toAttestationDocument, ensureIndexes, closeMongo } from "../src/mongo.ts";

const { web3 } = anchor;
const { PublicKey, Connection } = web3;

const idl = JSON.parse(
  readFileSync(new URL("../../program/target/idl/provenance.json", import.meta.url), "utf8")
);
const programId = new PublicKey(idl.address);
const connection = new Connection(RPC_URL, "confirmed");

console.log("program id:", programId.toBase58());
console.log("rpc:", RPC_URL);

const accounts = await connection.getProgramAccounts(programId);
console.log(`found ${accounts.length} on-chain account(s)`);

await ensureIndexes();

let indexed = 0;
let skipped = 0;
for (const { pubkey, account } of accounts) {
  let record;
  try {
    record = decodePhotoAttestation(account.data, pubkey.toBase58());
  } catch (err) {
    console.warn(`skipping ${pubkey.toBase58()}: not a PhotoAttestation (${(err as Error).message})`);
    skipped++;
    continue;
  }

  // Best-effort tx signature lookup (the oldest confirmed signature for this PDA is the
  // creating attest_photo tx) — not load-bearing for the index, so a failure here doesn't
  // block reindexing.
  let txSignature: string | null = null;
  try {
    const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 1 });
    txSignature = sigs[0]?.signature ?? null;
  } catch {
    // leave null
  }

  await indexAttestation(toAttestationDocument(record, { txSignature }));
  indexed++;
  console.log(`indexed ${record.sha256} → ${pubkey.toBase58()}`);
}

console.log(`\ndone: ${indexed} indexed, ${skipped} skipped`);
await closeMongo();
