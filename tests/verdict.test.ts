import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amberVerdictFromVerifyResponse,
  decodePhotoAttestation,
  formatUnixSeconds,
  truncateKey,
} from "../lib/verdict.ts";
import { bytesToHex } from "../lib/manifest.ts";

const SHA = new Uint8Array(32).fill(0x11);
const PUB = new Uint8Array(32).fill(0x22);
const PARENT = new Uint8Array(32).fill(0x33);
const PHASH = 0x0123456789abcdefn;
const TS = 1_700_000_000; // 2023-11-14T22:13:20Z
const SLOT = 424_242n;

/** Builds a PhotoAttestation account buffer matching the on-chain layout. */
function accountBytes(parent: Uint8Array | null): Uint8Array {
  const size = 8 + 32 + 8 + 32 + 8 + 1 + (parent ? 32 : 0) + 8;
  const data = new Uint8Array(size);
  const view = new DataView(data.buffer);
  let o = 0;
  data.set([0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef], o); // discriminator
  o += 8;
  data.set(SHA, o);
  o += 32;
  view.setBigUint64(o, PHASH, true);
  o += 8;
  data.set(PUB, o);
  o += 32;
  view.setBigInt64(o, BigInt(TS), true);
  o += 8;
  view.setUint8(o, parent ? 1 : 0);
  o += 1;
  if (parent) {
    data.set(parent, o);
    o += 32;
  }
  view.setBigUint64(o, SLOT, true);
  return data;
}

test("decodes a PhotoAttestation account without a parent hash", () => {
  const decoded = decodePhotoAttestation(accountBytes(null));
  assert.equal(bytesToHex(decoded.sha256), "11".repeat(32));
  assert.equal(decoded.phash, PHASH);
  assert.equal(bytesToHex(decoded.devicePubkey), "22".repeat(32));
  assert.equal(decoded.timestamp, TS);
  assert.equal(decoded.slot, SLOT);
});

test("decodes across an Option::Some parent hash (slot sits 32 bytes later)", () => {
  const decoded = decodePhotoAttestation(accountBytes(PARENT));
  assert.equal(bytesToHex(decoded.sha256), "11".repeat(32));
  assert.equal(decoded.timestamp, TS);
  assert.equal(decoded.slot, SLOT);
});

test("decode respects a nonzero byteOffset (web3.js Buffers share pooled ArrayBuffers)", () => {
  const account = accountBytes(null);
  const pool = new Uint8Array(account.length + 16).fill(0xff);
  pool.set(account, 7);
  const decoded = decodePhotoAttestation(pool.subarray(7, 7 + account.length));
  assert.equal(bytesToHex(decoded.sha256), "11".repeat(32));
  assert.equal(decoded.phash, PHASH);
  assert.equal(decoded.slot, SLOT);
});

test("decode throws on a truncated account rather than fabricating fields", () => {
  assert.throws(() => decodePhotoAttestation(accountBytes(null).subarray(0, 40)));
});

test("formatUnixSeconds renders the app's timestamp format", () => {
  assert.equal(formatUnixSeconds(0), "1970-01-01 00:00:00 UTC");
  assert.equal(formatUnixSeconds(TS), "2023-11-14 22:13:20 UTC");
});

test("truncateKey keeps first and last four characters", () => {
  assert.equal(truncateKey("3f2a00000000000000009b0c"), "3f2a…9b0c");
});

const AMBER_BODY = {
  tier: "amber",
  record: {
    sha256: "aa".repeat(32),
    devicePubkey: "FNY6avv7000000000000000000000000000000m3tA",
    timestamp: TS,
    explorerUrl: "https://explorer.solana.com/address/abc?cluster=devnet",
  },
  hammingDistance: 3,
};

test("maps a well-formed amber /verify response to an AMBER verdict", () => {
  const verdict = amberVerdictFromVerifyResponse(AMBER_BODY);
  assert.deepEqual(verdict, {
    tier: "amber",
    record: {
      sha256: "aa".repeat(32),
      capturedAt: "2023-11-14 22:13:20 UTC",
      devicePubkey: "FNY6…m3tA",
      txSignature: "unknown",
      explorerUrl: "https://explorer.solana.com/address/abc?cluster=devnet",
    },
    hammingDistance: 3,
  });
});

test("a missing hammingDistance maps to undefined, not a fake distance", () => {
  const { hammingDistance: _ignored, ...body } = AMBER_BODY;
  const verdict = amberVerdictFromVerifyResponse(body);
  assert.equal(verdict?.tier, "amber");
  assert.equal(verdict?.hammingDistance, undefined);
});

test("backend green is never surfaced — the client's own chain read owns GREEN", () => {
  assert.equal(amberVerdictFromVerifyResponse({ ...AMBER_BODY, tier: "green" }), null);
});

test("non-amber, malformed, and partial bodies all map to null (→ GREY), never a verdict", () => {
  assert.equal(amberVerdictFromVerifyResponse(null), null);
  assert.equal(amberVerdictFromVerifyResponse("amber"), null);
  assert.equal(amberVerdictFromVerifyResponse({}), null);
  assert.equal(amberVerdictFromVerifyResponse({ tier: "grey" }), null);
  assert.equal(amberVerdictFromVerifyResponse({ tier: "amber" }), null);
  assert.equal(amberVerdictFromVerifyResponse({ tier: "amber", record: null }), null);
  for (const field of ["sha256", "devicePubkey", "timestamp", "explorerUrl"] as const) {
    const record: Record<string, unknown> = { ...AMBER_BODY.record };
    delete record[field];
    assert.equal(
      amberVerdictFromVerifyResponse({ ...AMBER_BODY, record }),
      null,
      `missing ${field} must not produce a verdict`
    );
    const wrongTyped = field === "timestamp" ? "1700000000" : 42;
    assert.equal(
      amberVerdictFromVerifyResponse({ ...AMBER_BODY, record: { ...AMBER_BODY.record, [field]: wrongTyped } }),
      null,
      `wrong-typed ${field} must not produce a verdict`
    );
  }
});
