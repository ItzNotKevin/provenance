import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PORT } from "./config.ts";
import { submitAttestation, InvalidSignatureError, DuplicateAttestationError } from "./chain.ts";

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

async function handleAttest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    const result = await submitAttestation({
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

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/attest") {
    void handleAttest(req, res);
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
