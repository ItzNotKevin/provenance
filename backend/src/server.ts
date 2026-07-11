import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { PORT, MONGODB_URI } from "./config.ts";
import {
  submitAttestation,
  lookupAttestation,
  phashFromHex,
  InvalidSignatureError,
  DuplicateAttestationError,
} from "./chain.ts";
import { indexAttestation, toAttestationDocument, queryRecent, findAmberCandidates } from "./mongo.ts";
import { computePhashFromImageBytes, ImageDecodeError } from "./imagePhash.ts";

// Generous but bounded — a full-quality phone photo plus ~33% base64 overhead comfortably
// fits; this just guards against unbounded memory use from a malformed/hostile request
// (ROADMAP Rung 10 "demo-proofing: large files").
const MAX_BODY_BYTES = 30 * 1024 * 1024;

class PayloadTooLargeError extends Error {}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new PayloadTooLargeError(`request body exceeds ${MAX_BODY_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

interface AttestRequestBody {
  sha256: string;
  timestamp: number;
  devicePubkey: string;
  signature: string;
  phash?: string;
  parentHash?: string | null;
  /** base64-encoded original photo bytes — see computeImagePhash below for what this unlocks. */
  imageBase64?: string;
}

function isAttestRequestBody(body: unknown): body is AttestRequestBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.sha256 === "string" &&
    typeof b.timestamp === "number" &&
    typeof b.devicePubkey === "string" &&
    typeof b.signature === "string"
  );
}

/**
 * Write-through indexing: after a chain submission succeeds, re-read the now-confirmed PDA
 * and mirror it into Mongo (the search index for /recent, keyed by sha256). Runs after the
 * HTTP response is already sent — a slow or unreachable Mongo must never delay or fail an
 * attest, since the chain write already succeeded and is the source of truth. Silently
 * no-ops if MONGODB_URI isn't configured (see backend/README.md).
 */
async function indexAfterAttest(sha256Hex: string, txSignature: string): Promise<void> {
  if (!MONGODB_URI) return;
  try {
    const record = await lookupAttestation(sha256Hex);
    if (!record) return; // shouldn't happen right after a confirmed submit, but don't index a ghost
    await indexAttestation(toAttestationDocument(record, { txSignature }));
  } catch (err) {
    console.warn("mongo indexing failed (non-fatal, chain write already succeeded):", err);
  }
}

/**
 * pHash-at-ingest (ROADMAP Rung 6 / lib/CLAUDE.md's v1 decision): if the client uploaded the
 * actual photo bytes, decode them and compute the real pHash server-side, so it can be baked
 * permanently into the immutable on-chain record at creation time (there's no "update pHash"
 * instruction — PhotoAttestation PDAs are init-only). Critically, this first verifies the
 * uploaded bytes hash to the *same* SHA-256 the device already signed — that's what ties the
 * pHash back to the cryptographically-attested photo rather than to arbitrary uploaded bytes,
 * even though the pHash itself is never part of the signed message. Returns `undefined` if no
 * image was uploaded (falls back to the client-supplied `phash` field, or 0).
 */
async function computeImagePhash(body: AttestRequestBody): Promise<bigint | undefined> {
  if (!body.imageBase64) {
    return body.phash !== undefined ? phashFromHex(body.phash) : undefined;
  }
  const bytes = Buffer.from(body.imageBase64, "base64");
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== body.sha256.toLowerCase()) {
    throw new InvalidSignatureError(
      "uploaded image bytes do not hash to the signed sha256 — refusing to compute pHash from unrelated bytes"
    );
  }
  const phashHex = await computePhashFromImageBytes(bytes);
  return phashFromHex(phashHex);
}

async function handleAttest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return sendJson(res, 413, { error: err.message });
    }
    return sendJson(res, 400, { error: (err as Error).message });
  }

  if (!isAttestRequestBody(body)) {
    return sendJson(res, 400, {
      error: "expected { sha256, timestamp, devicePubkey, signature, phash?, parentHash?, imageBase64? }",
    });
  }

  try {
    const phash = await computeImagePhash(body);
    const result = await submitAttestation({
      sha256Hex: body.sha256,
      timestamp: body.timestamp,
      devicePubkeyHex: body.devicePubkey,
      signatureHex: body.signature,
      phash,
      parentHashHex: body.parentHash ?? null,
    });
    sendJson(res, 200, result);
    void indexAfterAttest(body.sha256, result.txSignature);
  } catch (err) {
    if (err instanceof InvalidSignatureError) {
      return sendJson(res, 400, { error: err.message });
    }
    if (err instanceof DuplicateAttestationError) {
      return sendJson(res, 409, { error: err.message });
    }
    if (err instanceof ImageDecodeError) {
      return sendJson(res, 400, { error: err.message });
    }
    console.error("attest failed:", err);
    sendJson(res, 502, { error: "chain submission failed", detail: (err as Error).message });
  }
}

const SHA256_HEX = /^[0-9a-fA-F]{64}$/;
const PHASH_HEX = /^[0-9a-fA-F]{16}$/;

/**
 * GREEN-tier verdict: read the PDA for this SHA-256 directly from the chain.
 * `{ tier: "green", record }` when the photo is attested on-chain, `{ tier: "grey" }` otherwise.
 * No database, no fee payer — a pure, unforgeable chain read.
 */
async function handleLookup(res: ServerResponse, sha256Hex: string): Promise<void> {
  if (!SHA256_HEX.test(sha256Hex)) {
    return sendJson(res, 400, { error: "sha256 must be 64 hex characters" });
  }
  try {
    const record = await lookupAttestation(sha256Hex.toLowerCase());
    if (record) return sendJson(res, 200, { tier: "green", record });
    return sendJson(res, 200, { tier: "grey" });
  } catch (err) {
    console.error("lookup failed:", err);
    // Chain unreachable → GREY, never a false positive (lib/CLAUDE.md iron rule).
    sendJson(res, 502, { error: "chain read failed", detail: (err as Error).message });
  }
}

/**
 * Registry list (lib/CLAUDE.md #3 `recentAttestations`): paginated read of the Mongo mirror,
 * newest-first. Every field here was chain-confirmed at index time (see indexAfterAttest /
 * scripts/reindex.ts) — Mongo only ever proposes an ordering and pagination convenience, it
 * never introduces a fact the chain didn't already confirm.
 */
async function handleRecent(res: ServerResponse, url: URL): Promise<void> {
  if (!MONGODB_URI) {
    return sendJson(res, 200, { records: [], nextCursor: null });
  }
  const limitParam = url.searchParams.get("limit");
  const beforeParam = url.searchParams.get("before");
  try {
    const page = await queryRecent({
      limit: limitParam ? Number(limitParam) : undefined,
      before: beforeParam ? Number(beforeParam) : undefined,
    });
    sendJson(res, 200, page);
  } catch (err) {
    console.error("recent query failed:", err);
    sendJson(res, 502, { error: "mongo query failed", detail: (err as Error).message });
  }
}

interface VerifyRequestBody {
  sha256: string;
  phash?: string;
}

function isVerifyRequestBody(body: unknown): body is VerifyRequestBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b.sha256 === "string" && (b.phash === undefined || typeof b.phash === "string");
}

/**
 * Full three-tier verdict (lib/CLAUDE.md): GREEN (exact chain read) → AMBER (pHash candidate
 * search, chain-confirmed before display) → GREY (no match). Implements the iron rule for
 * AMBER: every candidate from findAmberCandidates is a *proposal only* — it's re-read from
 * the chain via lookupAttestation before ever being returned, so a stale or fabricated Mongo
 * document can never surface as evidence. If the top candidate fails to confirm (shouldn't
 * happen for real indexed data, but Mongo is untrusted by design), the next candidate is
 * tried rather than immediately falling back to GREY.
 */
async function handleVerify(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: (err as Error).message });
  }
  if (!isVerifyRequestBody(body)) {
    return sendJson(res, 400, { error: "expected { sha256, phash? }" });
  }
  if (!SHA256_HEX.test(body.sha256)) {
    return sendJson(res, 400, { error: "sha256 must be 64 hex characters" });
  }
  if (body.phash !== undefined && !PHASH_HEX.test(body.phash)) {
    return sendJson(res, 400, { error: "phash must be 16 hex characters" });
  }

  try {
    const sha256Hex = body.sha256.toLowerCase();

    const green = await lookupAttestation(sha256Hex);
    if (green) return sendJson(res, 200, { tier: "green", record: green });

    if (body.phash && MONGODB_URI) {
      const candidates = await findAmberCandidates(body.phash.toLowerCase(), { limit: 5 });
      for (const candidate of candidates) {
        const confirmed = await lookupAttestation(candidate.document.sha256);
        if (confirmed) {
          return sendJson(res, 200, {
            tier: "amber",
            record: confirmed,
            hammingDistance: candidate.hammingDistance,
          });
        }
        // Mongo proposed a candidate the chain doesn't confirm (e.g. stale doc) — never
        // trust it; move on to the next candidate instead of surfacing it.
      }
    }

    return sendJson(res, 200, { tier: "grey" });
  } catch (err) {
    console.error("verify failed:", err);
    // Chain/Mongo unreachable → GREY, never a false positive (lib/CLAUDE.md iron rule).
    sendJson(res, 502, { error: "verify failed", detail: (err as Error).message });
  }
}

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/attest") {
    void handleAttest(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/verify") {
    void handleVerify(req, res);
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/recent")) {
    void handleRecent(res, new URL(req.url, `http://localhost:${PORT}`));
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/lookup/")) {
    const sha256Hex = decodeURIComponent(req.url.slice("/lookup/".length));
    void handleLookup(res, sha256Hex);
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, { ok: true });
  }
  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`provenance backend listening on :${PORT}`);
});
