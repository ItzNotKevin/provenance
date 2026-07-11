import { test } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { canonicalManifestBytes, bytesToHex } from "../../lib/manifest.ts";
import { submitAttestation, phashToHex, phashFromHex, InvalidSignatureError } from "../src/chain.ts";

// Account-decode tests (decodeAttestation/lookupAttestation) live in tests/lookup.test.ts —
// chain.ts only builds/submits the write transaction now; lookup.ts owns reads.

const SHA = "11".repeat(32);
const TS = 1_700_000_000;

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
