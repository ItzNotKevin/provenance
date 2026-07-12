import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import {
  submitAttestation,
  phashFromHex,
  InvalidSignatureError,
  DuplicateAttestationError,
} from "./chain.ts";
import { lookupAttestation, InvalidHashError, normalizeSha256 } from "./lookup.ts";
import { computePhashFromImageBytes, ImageDecodeError } from "./imagePhash.ts";
import {
  indexAttestation,
  toAttestationDocument,
  queryRecent,
  findAmberCandidates,
  MongoNotConfiguredError,
} from "./mongo.ts";

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
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
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

interface VerifyRequestBody {
  sha256: string;
  phash?: string;
  /** Raw image bytes (base64), for clients that can't compute pHash on-device (see lib/CLAUDE.md's
   *  v1 decision — native has no cheap raw-pixel API). Mirrors /attest's imageBase64 pattern:
   *  verified against `sha256` before anything is computed from it. Takes priority over `phash`. */
  imageBase64?: string;
}

const PHASH_HEX = /^[0-9a-fA-F]{16}$/;

function isVerifyRequestBody(body: unknown): body is VerifyRequestBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.sha256 === "string" &&
    (b.phash === undefined || typeof b.phash === "string") &&
    (b.imageBase64 === undefined || typeof b.imageBase64 === "string")
  );
}

/**
 * Resolves the pHash to search AMBER candidates with: prefers computing it server-side from
 * uploaded image bytes (verified against the given sha256 first, same binding as /attest's
 * computeImagePhash), falling back to a client-supplied hex phash. Returns undefined if neither
 * was provided — callers skip AMBER entirely in that case, same as before this existed.
 */
async function resolveVerifyPhash(body: VerifyRequestBody, sha256Hex: string): Promise<string | undefined> {
  if (!body.imageBase64) return body.phash?.toLowerCase();

  const bytes = Buffer.from(body.imageBase64, "base64");
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== sha256Hex) {
    throw new InvalidHashError(
      "uploaded image bytes do not hash to the given sha256 — refusing to compute pHash from unrelated bytes"
    );
  }
  return computePhashFromImageBytes(bytes);
}

export interface RequestHandlerDependencies {
  submitAttestation: typeof submitAttestation;
  lookupAttestation: typeof lookupAttestation;
  indexAttestation: typeof indexAttestation;
  queryRecent: typeof queryRecent;
  findAmberCandidates: typeof findAmberCandidates;
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

/**
 * Write-through indexing: after a chain submission succeeds, re-read the now-confirmed PDA
 * and mirror it into Mongo (the search index for /recent and AMBER candidate search, keyed by
 * sha256). Runs after the HTTP response is already sent — a slow or unreachable Mongo must
 * never delay or fail an attest, since the chain write already succeeded and is the source of
 * truth. Silently no-ops if MONGODB_URI isn't configured (see backend/README.md).
 */
async function indexAfterAttest(
  deps: RequestHandlerDependencies,
  sha256Hex: string,
  txSignature: string
): Promise<void> {
  try {
    const record = await deps.lookupAttestation(sha256Hex);
    if (!record) return; // shouldn't happen right after a confirmed submit, but don't index a ghost
    await deps.indexAttestation(toAttestationDocument(record, { txSignature }));
  } catch (err) {
    if (err instanceof MongoNotConfiguredError) return; // feature disabled, not a failure
    console.warn("mongo indexing failed (non-fatal, chain write already succeeded):", err);
  }
}

async function handleAttest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RequestHandlerDependencies
): Promise<void> {
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
    const result = await deps.submitAttestation({
      sha256Hex: body.sha256,
      timestamp: body.timestamp,
      devicePubkeyHex: body.devicePubkey,
      signatureHex: body.signature,
      phash,
      parentHashHex: body.parentHash ?? null,
    });
    sendJson(res, 200, result);
    void indexAfterAttest(deps, body.sha256, result.txSignature);
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

async function handleLookup(
  sha256: string,
  res: ServerResponse,
  lookup: typeof lookupAttestation
): Promise<void> {
  try {
    const normalizedHash = normalizeSha256(sha256);
    const record = await lookup(normalizedHash);
    if (!record) {
      return sendJson(res, 404, { tier: "grey", sha256: normalizedHash });
    }
    sendJson(res, 200, { tier: "green", record });
  } catch (err) {
    if (err instanceof InvalidHashError) {
      return sendJson(res, 400, { error: err.message });
    }
    console.error("lookup failed:", err);
    sendJson(res, 502, { error: "chain lookup failed", detail: (err as Error).message });
  }
}

/**
 * Registry list (lib/CLAUDE.md #3 `recentAttestations`): paginated read of the Mongo mirror,
 * newest-first. Every field here was chain-confirmed at index time (see indexAfterAttest /
 * scripts/reindex.ts) — Mongo only ever proposes an ordering and pagination convenience, it
 * never introduces a fact the chain didn't already confirm.
 */
async function handleRecent(
  res: ServerResponse,
  url: URL,
  deps: RequestHandlerDependencies
): Promise<void> {
  const limitParam = url.searchParams.get("limit");
  const beforeParam = url.searchParams.get("before");
  try {
    const page = await deps.queryRecent({
      limit: limitParam ? Number(limitParam) : undefined,
      before: beforeParam ? Number(beforeParam) : undefined,
    });
    sendJson(res, 200, page);
  } catch (err) {
    if (err instanceof MongoNotConfiguredError) {
      return sendJson(res, 200, { records: [], nextCursor: null });
    }
    console.error("recent query failed:", err);
    sendJson(res, 502, { error: "mongo query failed", detail: (err as Error).message });
  }
}

/**
 * Full three-tier verdict (lib/CLAUDE.md): GREEN (exact chain read) → AMBER (pHash candidate
 * search, chain-confirmed before display) → GREY (no match — mirrors /lookup's 404 convention
 * for API consistency). Implements the iron rule for AMBER: every candidate from
 * findAmberCandidates is a *proposal only* — it's re-read from the chain via lookupAttestation
 * before ever being returned, so a stale or fabricated Mongo document can never surface as
 * evidence. If the top candidate fails to confirm (shouldn't happen for real indexed data, but
 * Mongo is untrusted by design), the next candidate is tried rather than falling straight to GREY.
 */
async function handleVerify(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RequestHandlerDependencies
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return sendJson(res, 413, { error: err.message });
    }
    return sendJson(res, 400, { error: (err as Error).message });
  }
  if (!isVerifyRequestBody(body)) {
    return sendJson(res, 400, { error: "expected { sha256, phash?, imageBase64? }" });
  }
  if (body.phash !== undefined && !PHASH_HEX.test(body.phash)) {
    return sendJson(res, 400, { error: "phash must be 16 hex characters" });
  }

  let sha256Hex: string;
  try {
    sha256Hex = normalizeSha256(body.sha256);
  } catch (err) {
    if (err instanceof InvalidHashError) {
      return sendJson(res, 400, { error: err.message });
    }
    throw err;
  }

  let effectivePhash: string | undefined;
  try {
    effectivePhash = await resolveVerifyPhash(body, sha256Hex);
  } catch (err) {
    if (err instanceof InvalidHashError) {
      return sendJson(res, 400, { error: err.message });
    }
    if (err instanceof ImageDecodeError) {
      return sendJson(res, 400, { error: err.message });
    }
    throw err;
  }

  try {
    const green = await deps.lookupAttestation(sha256Hex);
    if (green) return sendJson(res, 200, { tier: "green", record: green });

    if (effectivePhash) {
      let candidates: Awaited<ReturnType<typeof deps.findAmberCandidates>> = [];
      try {
        candidates = await deps.findAmberCandidates(effectivePhash, { limit: 5 });
      } catch (err) {
        if (!(err instanceof MongoNotConfiguredError)) throw err;
        // feature disabled — fall through to GREY rather than treating it as a failure
      }
      for (const candidate of candidates) {
        const confirmed = await deps.lookupAttestation(candidate.document.sha256);
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

    return sendJson(res, 404, { tier: "grey", sha256: sha256Hex });
  } catch (err) {
    console.error("verify failed:", err);
    // Chain/Mongo unreachable → 502, never a false positive (lib/CLAUDE.md iron rule).
    sendJson(res, 502, { error: "verify failed", detail: (err as Error).message });
  }
}

export function createRequestHandler(
  overrides: Partial<RequestHandlerDependencies> = {}
): RequestListener {
  const dependencies: RequestHandlerDependencies = {
    submitAttestation,
    lookupAttestation,
    indexAttestation,
    queryRecent,
    findAmberCandidates,
    ...overrides,
  };

  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const requestId = Math.random().toString(36).slice(2, 8);
    console.log(`[${requestId}] ${req.method} ${url.pathname} from ${req.socket.remoteAddress}`);
    res.on("finish", () => {
      console.log(`[${requestId}] -> ${res.statusCode}`);
    });

    if (req.method === "POST" && url.pathname === "/attest") {
      void handleAttest(req, res, dependencies);
      return;
    }

    const lookupMatch = /^\/lookup\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && lookupMatch) {
      let sha256: string;
      try {
        sha256 = decodeURIComponent(lookupMatch[1]);
      } catch {
        return sendJson(res, 400, { error: "sha256 path parameter is malformed" });
      }
      void handleLookup(sha256, res, dependencies.lookupAttestation);
      return;
    }

    if (req.method === "GET" && url.pathname === "/recent") {
      void handleRecent(res, url, dependencies);
      return;
    }

    if (req.method === "POST" && url.pathname === "/verify") {
      void handleVerify(req, res, dependencies);
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }
    sendJson(res, 404, { error: "not found" });
  };
}
