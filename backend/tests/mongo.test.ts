import { test } from "node:test";
import assert from "node:assert/strict";
import { toAttestationDocument, type AttestationDocument } from "../src/mongo.ts";
import type { ChainAttestationRecord } from "../src/lookup.ts";

// toAttestationDocument is pure (no network) — connecting to Mongo itself is lazy and only
// happens on first query/index call, so this file needs no MONGODB_URI and stays in the
// offline fast suite.

const RECORD: ChainAttestationRecord = {
  sha256: "ab".repeat(32),
  phash: "0000000000000042", // canonical 16-char hex (see lib/phash.ts)
  devicePubkey: "cd".repeat(32),
  timestamp: 1_700_000_000,
  parentHash: null,
  slot: "12345", // lookup.ts keeps slot as a decimal string
  pda: "SomePdaAddress111111111111111111111111111",
  explorerUrl: "https://explorer.solana.com/address/SomePdaAddress?cluster=devnet",
};

test("maps a confirmed on-chain record into the Mongo document shape, keyed by sha256", () => {
  const doc: AttestationDocument = toAttestationDocument(RECORD, { txSignature: "sig123" });
  assert.equal(doc._id, RECORD.sha256); // content-addressed key, same as the PDA seed
  assert.equal(doc.sha256, RECORD.sha256);
  assert.equal(doc.phash, "0000000000000042");
  assert.equal(doc.phashVector.length, 64);
  assert.equal(doc.chainAddress, RECORD.pda);
  assert.equal(doc.timestamp, RECORD.timestamp);
  assert.equal(doc.device, RECORD.devicePubkey);
  assert.equal(doc.parentHash, null);
  assert.equal(doc.slot, 12345); // normalized to a number in the Mongo document
  assert.equal(doc.txSignature, "sig123");
  assert.equal(doc.explorerUrl, RECORD.explorerUrl);
  assert.ok(Number.isInteger(doc.indexedAt) && doc.indexedAt > 0);
});

test("carries a null txSignature through for reindex-sourced documents (no live tx at rebuild time)", () => {
  const doc = toAttestationDocument(RECORD, { txSignature: null });
  assert.equal(doc.txSignature, null);
});

test("preserves parentHash for edit-lineage attestations", () => {
  const withParent: ChainAttestationRecord = { ...RECORD, parentHash: "ef".repeat(32) };
  const doc = toAttestationDocument(withParent, { txSignature: "sig456" });
  assert.equal(doc.parentHash, "ef".repeat(32));
});
