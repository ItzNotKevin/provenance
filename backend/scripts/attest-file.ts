/**
 * CLI: attest one or more image files directly to devnet + Mongo, bypassing the mobile app.
 *
 * Signs each file with a persistent local "uploader" device key (generated on first run and
 * saved to backend/.attest-key.json — gitignored), so repeat uploads share one device identity
 * like a single camera would. Then POSTs to the running backend's /attest, which validates the
 * signature, co-signs as fee payer, submits attest_photo to devnet, computes the EXIF-corrected
 * pHash from the uploaded bytes, and indexes the record into Mongo — exactly the path the app
 * uses, just driven from the terminal.
 *
 * Run:  node scripts/attest-file.ts <image> [more images ...]
 *       (the backend must be running:  npm start)
 *
 * Env:  API_URL          backend base URL (default http://localhost:8787)
 *       ATTEST_KEY_PATH  where to persist the uploader key (default backend/.attest-key.json)
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import nacl from "tweetnacl";
import { canonicalManifestBytes, bytesToHex } from "../../lib/manifest.ts";

const API = process.env.API_URL ?? "http://localhost:8787";
const KEY_PATH = process.env.ATTEST_KEY_PATH
  ? new URL(`file://${process.env.ATTEST_KEY_PATH}`)
  : new URL("../.attest-key.json", import.meta.url);

function loadOrCreateUploaderKey(): nacl.SignKeyPair {
  if (existsSync(KEY_PATH)) {
    const secret = Uint8Array.from(JSON.parse(readFileSync(KEY_PATH, "utf8")));
    return nacl.sign.keyPair.fromSecretKey(secret);
  }
  const kp = nacl.sign.keyPair();
  writeFileSync(KEY_PATH, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`(generated a new uploader key → ${KEY_PATH.pathname})`);
  return kp;
}

async function attestFile(path: string, kp: nacl.SignKeyPair): Promise<void> {
  const name = basename(path);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    console.error(`✗ ${name}: file not found`);
    return;
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const timestamp = Math.floor(Date.now() / 1000);
  const devicePubkeyHex = bytesToHex(kp.publicKey);
  const message = canonicalManifestBytes(sha256, timestamp, devicePubkeyHex);
  const signature = bytesToHex(nacl.sign.detached(message, kp.secretKey));

  let res: Response;
  try {
    res = await fetch(`${API}/attest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sha256,
        timestamp,
        devicePubkey: devicePubkeyHex,
        signature,
        imageBase64: bytes.toString("base64"),
      }),
    });
  } catch (err) {
    console.error(`✗ ${name}: request failed — ${(err as Error).message}`);
    return;
  }

  const body: any = await res.json().catch(() => ({}));
  if (res.status === 409) {
    console.log(`• ${name}: already attested (${sha256.slice(0, 12)}…)`);
    return;
  }
  if (!res.ok) {
    console.error(`✗ ${name}: HTTP ${res.status} — ${body.error ?? JSON.stringify(body)}`);
    return;
  }

  console.log(`✓ ${name}`);
  console.log(`    sha256: ${sha256}`);
  console.log(`    tx:     ${body.txSignature}`);
  console.log(`    ${body.explorerUrl}`);
}

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: node scripts/attest-file.ts <image> [more images ...]");
    process.exit(1);
  }

  const health = await fetch(`${API}/health`)
    .then((r) => r.json())
    .catch(() => null);
  if (!health?.ok) {
    console.error(`backend not reachable at ${API} — start it first:  cd backend && npm start`);
    process.exit(1);
  }

  const kp = loadOrCreateUploaderKey();
  console.log(`uploader device: ${bytesToHex(kp.publicKey)}\n`);

  for (const file of files) {
    await attestFile(file, kp);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
