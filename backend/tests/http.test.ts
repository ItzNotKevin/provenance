import { createServer, type RequestListener } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequestHandler } from "../src/http.ts";

const SHA = "11".repeat(32);
const RECORD = {
  sha256: SHA,
  phash: "0000000000000000", // canonical 16-char hex (see lib/phash.ts)
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

async function post(handler: RequestListener, path: string, body: unknown): Promise<Response> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
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

const ATTEST_RESULT = { txSignature: "sig", explorerUrl: "https://explorer.solana.com/tx/sig", pda: "pda" };

test("POST /attest submits without an image and still write-through indexes", async () => {
  let indexed: unknown = null;
  const response = await post(
    createRequestHandler({
      submitAttestation: async () => ATTEST_RESULT,
      lookupAttestation: async () => RECORD,
      indexAttestation: async (doc) => {
        indexed = doc;
      },
    }),
    "/attest",
    { sha256: SHA, timestamp: 1_700_000_000, devicePubkey: "device", signature: "sig" }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), ATTEST_RESULT);
  // indexAfterAttest is fire-and-forget after the response is sent — give it a tick.
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(indexed, "expected write-through indexing to have run");
});

test("POST /attest rejects uploaded image bytes that don't hash to the signed sha256", async () => {
  let submitCalled = false;
  const wrongBytes = Buffer.from("not the photo that was signed");
  const response = await post(
    createRequestHandler({
      submitAttestation: async () => {
        submitCalled = true;
        return ATTEST_RESULT;
      },
    }),
    "/attest",
    {
      sha256: SHA, // does not match sha256(wrongBytes)
      timestamp: 1_700_000_000,
      devicePubkey: "device",
      signature: "sig",
      imageBase64: wrongBytes.toString("base64"),
    }
  );

  assert.equal(response.status, 400);
  assert.equal(submitCalled, false);
  assert.match((await response.json()).error, /do not hash to the signed sha256/);
});

test("POST /attest rejects a malformed client-supplied phash before touching the chain", async () => {
  let submitCalled = false;
  const response = await post(
    createRequestHandler({
      submitAttestation: async () => {
        submitCalled = true;
        return ATTEST_RESULT;
      },
    }),
    "/attest",
    { sha256: SHA, timestamp: 1_700_000_000, devicePubkey: "device", signature: "sig", phash: "not-hex" }
  );

  assert.equal(response.status, 400);
  assert.equal(submitCalled, false);
});

const RECENT_DOC = {
  _id: SHA,
  sha256: SHA,
  phash: "0000000000000000",
  phashVector: new Array(64).fill(-1),
  chainAddress: "pda",
  timestamp: 1_700_000_000,
  device: "device",
  parentHash: null,
  slot: 123,
  txSignature: "sig",
  explorerUrl: "https://explorer.solana.com/address/pda?cluster=devnet",
  indexedAt: 1_700_000_001_000,
};

test("GET /recent returns the paginated mirror from queryRecent", async () => {
  const page = { records: [RECENT_DOC], nextCursor: null };
  const response = await get(
    createRequestHandler({ queryRecent: async () => page }),
    "/recent?limit=5"
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), page);
});

test("GET /recent passes the device query param through to queryRecent (the registry is a personal ledger, not a public feed)", async () => {
  let receivedDevice: string | undefined;
  const page = { records: [RECENT_DOC], nextCursor: null };
  const response = await get(
    createRequestHandler({
      queryRecent: async (opts) => {
        receivedDevice = opts?.device;
        return page;
      },
    }),
    "/recent?device=abc123"
  );

  assert.equal(response.status, 200);
  assert.equal(receivedDevice, "abc123");
});

test("GET /recent degrades to an empty page when Mongo isn't configured, instead of erroring", async () => {
  const response = await get(
    createRequestHandler({
      queryRecent: async () => {
        const { MongoNotConfiguredError } = await import("../src/mongo.ts");
        throw new MongoNotConfiguredError("not configured");
      },
    }),
    "/recent"
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { records: [], nextCursor: null });
});

test("POST /verify returns GREEN when the sha256 matches on-chain, without ever calling AMBER matching", async () => {
  let amberCalled = false;
  const response = await post(
    createRequestHandler({
      lookupAttestation: async () => RECORD,
      findAmberCandidates: async () => {
        amberCalled = true;
        return [];
      },
    }),
    "/verify",
    { sha256: SHA }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { tier: "green", record: RECORD });
  assert.equal(amberCalled, false);
});

test("POST /verify returns AMBER for a close pHash match, chain-confirmed before being returned", async () => {
  const CANDIDATE_SHA = "22".repeat(32);
  const response = await post(
    createRequestHandler({
      lookupAttestation: async (sha256) => (sha256 === SHA ? null : { ...RECORD, sha256 }),
      findAmberCandidates: async () => [
        { document: { sha256: CANDIDATE_SHA } as never, hammingDistance: 3 },
      ],
    }),
    "/verify",
    { sha256: SHA, phash: "0000000000000042" }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.tier, "amber");
  assert.equal(body.hammingDistance, 3);
  assert.equal(body.record.sha256, CANDIDATE_SHA);
});

test("POST /verify skips an AMBER candidate the chain doesn't confirm and tries the next one", async () => {
  const STALE_SHA = "33".repeat(32);
  const REAL_SHA = "44".repeat(32);
  const response = await post(
    createRequestHandler({
      lookupAttestation: async (sha256) => {
        if (sha256 === SHA) return null; // no GREEN
        if (sha256 === STALE_SHA) return null; // Mongo proposed it, chain doesn't confirm
        return { ...RECORD, sha256 };
      },
      findAmberCandidates: async () => [
        { document: { sha256: STALE_SHA } as never, hammingDistance: 1 },
        { document: { sha256: REAL_SHA } as never, hammingDistance: 4 },
      ],
    }),
    "/verify",
    { sha256: SHA, phash: "0000000000000042" }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.tier, "amber");
  assert.equal(body.record.sha256, REAL_SHA);
});

test("POST /verify returns GREY (404) when nothing matches, including when Mongo isn't configured", async () => {
  const response = await post(
    createRequestHandler({
      lookupAttestation: async () => null,
      findAmberCandidates: async () => {
        const { MongoNotConfiguredError } = await import("../src/mongo.ts");
        throw new MongoNotConfiguredError("not configured");
      },
    }),
    "/verify",
    { sha256: SHA, phash: "0000000000000042" }
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { tier: "grey", sha256: SHA });
});
