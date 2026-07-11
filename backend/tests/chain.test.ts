import { test } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { canonicalManifestBytes, bytesToHex, hexToBytes } from "../../lib/manifest.ts";
import {
  submitAttestation,
  decodePhotoAttestation,
  phashToHex,
  phashFromHex,
  InvalidSignatureError,
} from "../src/chain.ts";

const SHA = "11".repeat(32);
const TS = 1_700_000_000;

// The Anchor discriminator for PhotoAttestation (from program/target/idl/provenance.json).
const PHOTO_DISC = [253, 6, 187, 137, 242, 121, 200, 44];

/** Builds a raw PhotoAttestation account buffer mirroring the on-chain Borsh layout. */
function encodeAttestation(opts: {
  sha256Hex: string;
  phash: bigint;
  devicePubkeyHex: string;
  timestamp: bigint;
  parentHashHex: string | null;
  slot: bigint;
  bump: number;
}): Buffer {
  const parts: Buffer[] = [
    Buffer.from(PHOTO_DISC),
    Buffer.from(hexToBytes(opts.sha256Hex)),
    (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(opts.phash); return b; })(),
    Buffer.from(hexToBytes(opts.devicePubkeyHex)),
    (() => { const b = Buffer.alloc(8); b.writeBigInt64LE(opts.timestamp); return b; })(),
    opts.parentHashHex
      ? Buffer.concat([Buffer.from([1]), Buffer.from(hexToBytes(opts.parentHashHex))])
      : Buffer.from([0]),
    (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(opts.slot); return b; })(),
    Buffer.from([opts.bump]),
  ];
  return Buffer.concat(parts);
}

test("rejects a signature that doesn't match the canonical manifest bytes", async () => {
  const device = nacl.sign.keyPair();
  const devicePubkeyHex = bytesToHex(device.publicKey);

  // sign the WRONG message (tampered timestamp) — signature won't match TS
  const wrongMessage = canonicalManifestBytes(SHA, TS + 1, devicePubkeyHex);
  const signature = nacl.sign.detached(wrongMessage, device.secretKey);

  await assert.rejects(
    () =>
      submitAttestation({
        sha256Hex: SHA,
        timestamp: TS,
        devicePubkeyHex,
        signatureHex: bytesToHex(signature),
      }),
    InvalidSignatureError
  );
});

test("rejects malformed hex lengths before touching the network", async () => {
  await assert.rejects(
    () =>
      submitAttestation({
        sha256Hex: "ab", // too short
        timestamp: TS,
        devicePubkeyHex: "22".repeat(32),
        signatureHex: "33".repeat(64),
      }),
    InvalidSignatureError
  );
});

test("decodes a PhotoAttestation with no parent (parent_hash = None)", () => {
  const buf = encodeAttestation({
    sha256Hex: "ab".repeat(32),
    phash: 1234567890123456n,
    devicePubkeyHex: "cd".repeat(32),
    timestamp: 1783781518n,
    parentHashHex: null,
    slot: 475539301n,
    bump: 254,
  });
  const rec = decodePhotoAttestation(buf, "PdaAddr");
  assert.equal(rec.sha256, "ab".repeat(32));
  assert.equal(rec.phash, "000462d53c8abac0"); // canonical 16-char hex, same format as lib/phash.ts
  assert.equal(rec.devicePubkey, "cd".repeat(32));
  assert.equal(rec.timestamp, 1783781518);
  assert.equal(rec.parentHash, null);
  assert.equal(rec.slot, 475539301);
  assert.equal(rec.pda, "PdaAddr");
});

test("decodes a PhotoAttestation with a parent (edit lineage)", () => {
  const buf = encodeAttestation({
    sha256Hex: "12".repeat(32),
    phash: 0n,
    devicePubkeyHex: "34".repeat(32),
    timestamp: 1_700_000_000n,
    parentHashHex: "ef".repeat(32),
    slot: 999n,
    bump: 255,
  });
  const rec = decodePhotoAttestation(buf, "PdaAddr2");
  assert.equal(rec.parentHash, "ef".repeat(32)); // reads past the Option tag correctly
  assert.equal(rec.slot, 999); // slot offset shifts by 32 when parent is present
  assert.equal(rec.phash, "0000000000000000");
});

test("phashToHex / phashFromHex round-trip and match lib/phash.ts's 16-char hex format", () => {
  assert.equal(phashToHex(0n), "0000000000000000");
  assert.equal(phashToHex(1234567890123456n), "000462d53c8abac0");
  assert.equal(phashFromHex("000462d53c8abac0"), 1234567890123456n);
  assert.equal(phashFromHex(phashToHex(0xdeadbeefn)), 0xdeadbeefn);
});

test("phashFromHex rejects malformed input (not 16 hex chars)", () => {
  assert.throws(() => phashFromHex("abc"), InvalidSignatureError);
  assert.throws(() => phashFromHex("zzzz000000000000"), InvalidSignatureError);
});

test("rejects an account with the wrong discriminator", () => {
  const buf = encodeAttestation({
    sha256Hex: "ab".repeat(32),
    phash: 0n,
    devicePubkeyHex: "cd".repeat(32),
    timestamp: 0n,
    parentHashHex: null,
    slot: 0n,
    bump: 0,
  });
  buf[0] ^= 0xff; // corrupt the discriminator
  assert.throws(() => decodePhotoAttestation(buf, "Bad"), /not a PhotoAttestation/);
});
