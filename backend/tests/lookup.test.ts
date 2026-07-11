import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import anchor from "@coral-xyz/anchor";
import { PROGRAM_ID } from "../../lib/solanaConfig.ts";
import {
  InvalidAttestationAccountError,
  InvalidHashError,
  lookupAttestation,
} from "../src/lookup.ts";

const { PublicKey } = anchor.web3;
const SHA = "11".repeat(32);
const PARENT = "22".repeat(32);
const DEVICE_BYTES = Buffer.alloc(32, 7);

function encodedAttestation(): Buffer {
  const data = Buffer.alloc(130);
  const discriminator = createHash("sha256")
    .update("account:PhotoAttestation")
    .digest()
    .subarray(0, 8);
  discriminator.copy(data, 0);

  let offset = 8;
  Buffer.from(SHA, "hex").copy(data, offset);
  offset += 32;
  data.writeBigUInt64LE(0x1234n, offset);
  offset += 8;
  DEVICE_BYTES.copy(data, offset);
  offset += 32;
  data.writeBigInt64LE(1_700_000_000n, offset);
  offset += 8;
  data.writeUInt8(1, offset);
  offset += 1;
  Buffer.from(PARENT, "hex").copy(data, offset);
  offset += 32;
  data.writeBigUInt64LE(987_654n, offset);
  offset += 8;
  data.writeUInt8(255, offset);
  return data;
}

test("reads and decodes a program-owned attestation account", async () => {
  const record = await lookupAttestation(SHA.toUpperCase(), async () => ({
    data: encodedAttestation(),
    owner: new PublicKey(PROGRAM_ID),
  }));

  assert.ok(record);
  assert.equal(record.sha256, SHA);
  assert.equal(record.phash, "4660");
  assert.equal(record.devicePubkey, new PublicKey(DEVICE_BYTES).toBase58());
  assert.equal(record.timestamp, 1_700_000_000);
  assert.equal(record.parentHash, PARENT);
  assert.equal(record.slot, "987654");
  assert.match(record.explorerUrl, new RegExp(`/address/${record.pda}\\?cluster=devnet$`));
});

test("returns null when the derived PDA does not exist", async () => {
  assert.equal(await lookupAttestation(SHA, async () => null), null);
});

test("rejects malformed hashes before making an RPC request", async () => {
  let called = false;
  await assert.rejects(
    () =>
      lookupAttestation("not-a-sha256", async () => {
        called = true;
        return null;
      }),
    InvalidHashError
  );
  assert.equal(called, false);
});

test("rejects accounts not owned by the provenance program", async () => {
  await assert.rejects(
    () =>
      lookupAttestation(SHA, async () => ({
        data: encodedAttestation(),
        owner: PublicKey.default,
      })),
    InvalidAttestationAccountError
  );
});

test("rejects data with the wrong Anchor account discriminator", async () => {
  const data = encodedAttestation();
  data.fill(0, 0, 8);
  await assert.rejects(
    () =>
      lookupAttestation(SHA, async () => ({
        data,
        owner: new PublicKey(PROGRAM_ID),
      })),
    InvalidAttestationAccountError
  );
});
