import { createServer, type RequestListener } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequestHandler } from "../src/http.ts";

const SHA = "11".repeat(32);
const RECORD = {
  sha256: SHA,
  phash: "0",
  devicePubkey: "device",
  timestamp: 1_700_000_000,
  parentHash: null,
  slot: "123",
  pda: "pda",
  explorerUrl: "https://explorer.solana.com/address/pda?cluster=devnet",
};

async function get(handler: RequestListener, path: string): Promise<Response> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

test("GET /lookup/:sha256 returns a GREEN chain record", async () => {
  const response = await get(
    createRequestHandler({ lookupAttestation: async () => RECORD }),
    `/lookup/${SHA}`
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { tier: "green", record: RECORD });
});

test("GET /lookup/:sha256 returns GREY and 404 for a missing PDA", async () => {
  const response = await get(
    createRequestHandler({ lookupAttestation: async () => null }),
    `/lookup/${SHA}`
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { tier: "grey", sha256: SHA });
});

test("GET /lookup/:sha256 rejects malformed hashes without calling Solana", async () => {
  let called = false;
  const response = await get(
    createRequestHandler({
      lookupAttestation: async () => {
        called = true;
        return null;
      },
    }),
    "/lookup/not-a-hash"
  );

  assert.equal(response.status, 400);
  assert.equal(called, false);
  assert.match((await response.json()).error, /64 hexadecimal/);
});
