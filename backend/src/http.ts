import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import {
  submitAttestation,
  InvalidSignatureError,
  DuplicateAttestationError,
} from "./chain.ts";
import { lookupAttestation, InvalidHashError, normalizeSha256 } from "./lookup.ts";

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
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

export interface RequestHandlerDependencies {
  submitAttestation: typeof submitAttestation;
  lookupAttestation: typeof lookupAttestation;
}

async function handleAttest(
  req: IncomingMessage,
  res: ServerResponse,
  submit: typeof submitAttestation
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: (err as Error).message });
  }

  if (!isAttestRequestBody(body)) {
    return sendJson(res, 400, {
      error: "expected { sha256, timestamp, devicePubkey, signature, phash?, parentHash? }",
    });
  }

  try {
    const result = await submit({
      sha256Hex: body.sha256,
      timestamp: body.timestamp,
      devicePubkeyHex: body.devicePubkey,
      signatureHex: body.signature,
      phash: body.phash !== undefined ? BigInt(body.phash) : undefined,
      parentHashHex: body.parentHash ?? null,
    });
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof InvalidSignatureError) {
      return sendJson(res, 400, { error: err.message });
    }
    if (err instanceof DuplicateAttestationError) {
      return sendJson(res, 409, { error: err.message });
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

export function createRequestHandler(
  overrides: Partial<RequestHandlerDependencies> = {}
): RequestListener {
  const dependencies: RequestHandlerDependencies = {
    submitAttestation,
    lookupAttestation,
    ...overrides,
  };

  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "POST" && url.pathname === "/attest") {
      void handleAttest(req, res, dependencies.submitAttestation);
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

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }
    sendJson(res, 404, { error: "not found" });
  };
}
