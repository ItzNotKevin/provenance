import { test } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import {
  canonicalManifestBytes,
  CANONICAL_MESSAGE_LEN,
  hexToBytes,
  bytesToHex,
} from "../lib/manifest.ts";

const SHA = "11".repeat(32); // 32 bytes of 0x11
const PUB = "22".repeat(32); // 32 bytes of 0x22
const TS = 1_700_000_000;

test("hex round-trips and validates", () => {
  const bytes = new Uint8Array([0, 1, 15, 16, 255]);
  assert.equal(bytesToHex(bytes), "00010f10ff");
  assert.deepEqual(hexToBytes("00010f10ff"), bytes);
  assert.throws(() => hexToBytes("abc")); // odd length
  assert.throws(() => hexToBytes("zz")); // non-hex
});

test("canonical message layout matches the on-chain program", () => {
  const msg = canonicalManifestBytes(SHA, TS, PUB);
  assert.equal(msg.length, CANONICAL_MESSAGE_LEN);
  assert.equal(msg.length, 72);
  // sha256 at [0,32)
  assert.deepEqual(msg.slice(0, 32), hexToBytes(SHA));
  // timestamp i64 little-endian at [32,40)
  const tsBytes = new Uint8Array(8);
  new DataView(tsBytes.buffer).setBigInt64(0, BigInt(TS), true);
  assert.deepEqual(msg.slice(32, 40), tsBytes);
  // device pubkey at [40,72)
  assert.deepEqual(msg.slice(40, 72), hexToBytes(PUB));
});

test("canonical message rejects wrong-size inputs", () => {
  assert.throws(() => canonicalManifestBytes("11".repeat(16), TS, PUB)); // short sha
  assert.throws(() => canonicalManifestBytes(SHA, TS, "22".repeat(16))); // short pubkey
  assert.throws(() => canonicalManifestBytes(SHA, 1.5, PUB)); // non-integer ts
});

test("ed25519 sign/verify round-trip over the canonical message (the device→chain contract)", () => {
  const kp = nacl.sign.keyPair();
  const devicePubHex = bytesToHex(kp.publicKey);
  const msg = canonicalManifestBytes(SHA, TS, devicePubHex);

  const sig = nacl.sign.detached(msg, kp.secretKey);
  assert.equal(sig.length, 64);
  assert.ok(nacl.sign.detached.verify(msg, sig, kp.publicKey), "valid signature verifies");

  // tamper one byte of the message => verification fails (what the on-chain check relies on)
  const tampered = Uint8Array.from(msg);
  tampered[0] ^= 0x01;
  assert.equal(nacl.sign.detached.verify(tampered, sig, kp.publicKey), false);

  // wrong key => fails
  const other = nacl.sign.keyPair();
  assert.equal(nacl.sign.detached.verify(msg, sig, other.publicKey), false);
});
