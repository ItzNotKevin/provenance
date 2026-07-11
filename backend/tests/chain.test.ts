import { test } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { canonicalManifestBytes, bytesToHex } from "../../lib/manifest.ts";
import { submitAttestation, InvalidSignatureError } from "../src/chain.ts";

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
