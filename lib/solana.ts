/**
 * Real devnet read path for the provenance program (see program/README.md).
 *
 * Writes (attest_photo) go through the backend (backend/src/chain.ts), which owns the
 * fee-payer key server-side. Reads need no signing key, so it's safe to hit the public
 * devnet RPC directly from the client — this is what makes GREEN a pure, unforgeable
 * chain read with no database in the loop (see lib/CLAUDE.md).
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { hexToBytes, bytesToHex } from "@/lib/manifest";
import { PROGRAM_ID, DEVNET_RPC_URL, CLUSTER_QUERY } from "@/lib/solanaConfig";
import { BACKEND_URL, USE_FAKE_REGISTRY } from "@/lib/config";
import {
  amberVerdictFromVerifyResponse,
  decodePhotoAttestation,
  formatUnixSeconds,
  truncateKey,
} from "@/lib/verdict";
import type { AttestationRecord, Verdict } from "@/lib/registry";

const programId = new PublicKey(PROGRAM_ID);

let connection: Connection | null = null;
function getConnection(): Connection {
  if (!connection) connection = new Connection(DEVNET_RPC_URL, "confirmed");
  return connection;
}

function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${CLUSTER_QUERY}`;
}

function deriveAttestationPda(sha256: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("photo"), sha256],
    programId
  );
  return pda;
}

/**
 * AMBER fallback: asks the backend's chain-confirmed /verify (pHash + Atlas Vector
 * Search, see backend/src/http.ts) whether this photo is a near-duplicate of an
 * attested original — the case a direct GREEN chain read can never catch, since any
 * re-encode (a photo-library round-trip, a lossy share) changes the SHA-256 even
 * though the image is visually identical. Best-effort: any failure here (no
 * backend, no network, fake-registry mode) just means AMBER isn't available, not
 * that verification itself failed — the caller already has a real GREY answer.
 */
async function tryBackendVerify(sha256Hex: string, imageBytes: Uint8Array): Promise<Verdict | null> {
  if (USE_FAKE_REGISTRY) return null;
  try {
    const { bytesToBase64 } = await import("@/lib/deviceKey");
    const response = await fetch(`${BACKEND_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha256: sha256Hex, imageBase64: bytesToBase64(imageBytes) }),
    });
    if (!response.ok) return null;
    return amberVerdictFromVerifyResponse(await response.json());
  } catch {
    return null;
  }
}

/**
 * Reads the on-chain PDA for this hash. GREEN if it exists (pure chain read,
 * unforgeable). If not, and image bytes are available, falls through to the
 * backend's chain-confirmed AMBER match before giving up. GREY otherwise — never
 * a judgment beyond "no exact or near match found."
 */
export async function realLookupHash(sha256Hex: string, imageBytes?: Uint8Array): Promise<Verdict> {
  const conn = getConnection();
  const sha256 = hexToBytes(sha256Hex);
  const pda = deriveAttestationPda(sha256);

  const account = await conn.getAccountInfo(pda, "confirmed");
  if (!account) {
    if (imageBytes) {
      const amber = await tryBackendVerify(sha256Hex, imageBytes);
      if (amber) return amber;
    }
    return { tier: "grey" };
  }

  const decoded = decodePhotoAttestation(account.data);

  const signatures = await conn.getSignaturesForAddress(pda, { limit: 1 });
  const txSignature = signatures[0]?.signature ?? "unknown";

  const devicePubkeyHex = bytesToHex(decoded.devicePubkey);
  const record: AttestationRecord = {
    sha256: bytesToHex(decoded.sha256),
    capturedAt: formatUnixSeconds(decoded.timestamp),
    devicePubkey: truncateKey(devicePubkeyHex),
    txSignature: txSignature === "unknown" ? "unknown" : truncateKey(txSignature),
    explorerUrl: txSignature === "unknown" ? explorerTxUrl(pda.toBase58()) : explorerTxUrl(txSignature),
  };

  return { tier: "green", record };
}
