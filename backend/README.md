# Provenance backend

Validates a device-signed capture manifest, co-signs as **fee payer**, and submits
`attest_photo` to the deployed devnet program (`EoWdD…jZ8g`). This is the piece that makes
[lib/registry.ts](../lib/registry.ts)'s `attestPhoto` real instead of `setTimeout`-faked — see
[lib/CLAUDE.md](../lib/CLAUDE.md) for the full seam description.

## Status

- ✅ `POST /attest` — validates the Ed25519 signature over the canonical manifest bytes, then
  builds and submits the same 2-instruction transaction as `program/tests/smoke.ts` (Ed25519
  precompile verify + `attest_photo`).
- ✅ `GET /lookup/:sha256` — GREEN-tier verdict. Derives the PDA from the SHA-256 and reads it
  directly from devnet (read-only: no fee payer, signs/spends nothing). Returns
  `{ "tier": "green", "record": {…} }` when the photo is attested on-chain, `{ "tier": "grey" }`
  otherwise, `400` for a malformed hash. Account bytes are decoded manually
  (`decodePhotoAttestation`), matching the layout in `program/…/lib.rs` and the client-side
  decoder in `lib/solana.ts`. Verified live + offline decode tests (`npm test`).
- ✅ Verified against the real deployed devnet program via `scripts/dry-run.ts`
  (`simulateTransaction`, no funds required) — IDL loads, PDA derivation matches, canonical
  message bytes match the on-chain program, signature validates.
- ✅ **Fee payer funded and live.** The default fallback (`~/.config/solana/id.json`, pubkey
  `FNY6avv7s7MxhkKusvUHczXQt4AHPwX63gf9KpeLm3tA`) has SOL on devnet — real `/attest` transactions
  submit successfully, no `FEE_PAYER_*` env var needed on this machine. (Grab a free
  Helius/QuickNode **devnet** RPC key before the demo — the public endpoint used by default,
  `https://api.devnet.solana.com`, rate-limits under load — ROADMAP Rung 1.)
- ✅ Mongo indexing (`src/mongo.ts`) — write-through on every successful `/attest`, plus
  `GET /recent` (paginated, newest-first) and `scripts/reindex.ts` to rebuild the whole index
  from `getProgramAccounts`. See "Mongo" below.
- ✅ **`POST /verify` — full three-tier verdict**, with Atlas Vector Search-accelerated AMBER
  matching. GREEN (exact chain read) → AMBER (pHash nearest-neighbor search, every candidate
  re-read from the chain before it's trusted) → GREY (no match). See "AMBER matching" below.
- ✅ **pHash-at-ingest.** `/attest` accepts an optional `imageBase64` field (the exact captured
  bytes). The server re-hashes them and rejects the request if they don't match the
  already-signed `sha256` (`computeImagePhash` in `src/server.ts`), then decodes via `sharp`
  (`src/imagePhash.ts`) and computes the real pHash — baked into the immutable on-chain record
  at creation, since there's no "update pHash" instruction. `lib/registry.ts`'s `attestPhoto`
  and `app/(tabs)/capture.tsx` are wired to send it. Live-tested end to end: attested a real
  image (on-chain `phash` came back non-zero), a never-attested recompressed derivative of it
  correctly AMBER-matched via `/verify`, a tampered upload was rejected, and a genuinely
  unrelated image correctly returned GREY. Rest of ROADMAP Rung 6.

## Run

```bash
cd backend
npm install
npm start                              # POST /attest on :8787, GET /health
```

Env vars (all optional). `npm start`/`npm run dev` auto-load `backend/.env` if present
(via `node --env-file-if-exists`); `.env` is gitignored — never commit secrets.

| Var | Default | Purpose |
|---|---|---|
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | devnet RPC endpoint |
| `PORT` | `8787` | HTTP port |
| `MONGODB_URI` | — | Atlas connection string (search index — see "Mongo" below) |
| `FEE_PAYER_SECRET_KEY` | — | JSON array of 64 bytes (inline secret key) |
| `FEE_PAYER_KEYPAIR_PATH` | `~/.config/solana/id.json` | path to a keypair file |

To use a different fee-payer keypair (e.g. a dedicated demo wallet instead of your local Solana
CLI default), set `FEE_PAYER_KEYPAIR_PATH` or `FEE_PAYER_SECRET_KEY` — see the table above.

Requires `program/target/idl/provenance.json` to exist — generate it with
`cd program && node scripts/gen-idl.mjs` (or `./build.sh`; see `program/README.md`; do **not**
use `anchor build`).

## Sanity-check without spending SOL

```bash
node scripts/dry-run.ts
```

Signs a fake manifest, builds the real transaction, and `simulateTransaction`s it against the
live devnet program — validates the whole pipeline (IDL, PDA seeds, ed25519 instruction, message
layout) without needing a funded wallet or spending anything.

## Mongo (search index, not source of truth)

`MONGODB_URI` (Atlas connection string, in `.env`, gitignored) turns on:

- **Write-through indexing** — every successful `/attest` re-reads the just-confirmed PDA
  (`lookupAttestation`) and upserts it into Mongo, keyed by `sha256`. Never blocks or fails the
  attest response; a slow/unreachable Mongo just logs a warning (the chain write already
  succeeded and is the only source of truth).
- **`GET /recent?limit=&before=`** — paginated, newest-first read of the Mongo mirror. Backs
  `recentAttestations()` in [lib/registry.ts](../lib/registry.ts) (the registry tab). Returns
  `{ records: [], nextCursor: null }` if `MONGODB_URI` isn't set, rather than erroring.
- **`npm run reindex`** (`scripts/reindex.ts`) — rebuilds the whole index from scratch by
  scanning `getProgramAccounts` and decoding every `PhotoAttestation`. Idempotent (upserts by
  `sha256`), safe to run anytime, and is what makes "the index is fully rebuildable by replaying
  the chain" (root CLAUDE.md) literally true rather than an aspiration.

Document shape: `{sha256, phash, phashVector, chainAddress, timestamp, device, parentHash, slot,
txSignature, explorerUrl, indexedAt}` — see `src/mongo.ts` for the full `AttestationDocument` type.

## pHash-at-ingest (image upload)

`POST /attest` accepts an optional `imageBase64` field — the exact bytes the device hashed and
signed, base64-encoded. When present (`computeImagePhash` in `src/server.ts`):

1. The server re-hashes the decoded bytes with `sha256` and **rejects the request (400)** if it
   doesn't match the already-signed `sha256` field. This is the critical binding: it ties the
   pHash back to the cryptographically-attested photo, even though the pHash itself is never
   part of the signed message (see the signing contract in root `CLAUDE.md`).
2. `computePhashFromImageBytes` (`src/imagePhash.ts`) decodes the image with `sharp` and runs
   the real DCT pHash core (`lib/phash.ts` → `pHashFromRgba`). Malformed image bytes are
   rejected with `400` (`ImageDecodeError`), not a `500`.
3. The computed pHash is passed into `attest_photo` and **baked into the immutable on-chain
   record at creation** — there's no "update pHash" instruction, so this has to happen before
   submission, not after.

`imageBase64` is optional — an `/attest` call without it still succeeds exactly as before, just
with no findable AMBER evidence for that photo later. The request body is capped at 30MB
(`MAX_BODY_BYTES` in `src/server.ts`) to bound memory use from a malformed/hostile upload.

Live-tested end to end against real devnet + real Atlas: attested a real synthetic JPEG (the
on-chain `phash` came back non-zero, e.g. `9a7fff7fffffffff`), then a *never-attested*
recompressed derivative of the same image correctly AMBER-matched back to it via `/verify`
(`hammingDistance: 0`), a tampered upload (image bytes that don't match the signed hash) was
correctly rejected, and a genuinely unrelated random image correctly returned `{tier:"grey"}`.

## AMBER matching (Atlas Vector Search + Hamming distance)

`phash` is always the canonical 16-char hex format from [lib/phash.ts](../lib/phash.ts) (same
format the DCT pHash core produces everywhere else). Each document also stores `phashVector`:
the same 64 bits re-encoded as an array of `±1` — chosen because for vectors with elements in
`{-1, +1}`, squared Euclidean distance is exactly `4 × Hamming distance` (proved in
`tests/phashVector.test.ts`), so ranking by Euclidean distance is *identical* to ranking by
Hamming distance. That lets Atlas's `$vectorSearch` (ANN, via an HNSW index) do the fast
candidate-narrowing step instead of a full collection scan.

- **One-time setup:** `npm run create-vector-index` (`scripts/create-vector-index.ts`) creates
  the `phash_vector_index` Search index (`euclidean` similarity, 64 dimensions) and polls until
  Atlas reports it queryable. Confirmed working on this project's M0 (free tier) cluster.
- **`findAmberCandidates(phashHex)`** (`src/mongo.ts`) runs `$vectorSearch` for nearest
  neighbors, then **recomputes the exact Hamming distance** for every candidate
  (`hammingDistanceHex`, from `lib/phash.ts`) and filters/sorts by that — the ANN stage is a
  speed optimization only, never the source of truth for "close enough." Falls back
  automatically to a full scan if the index isn't ready yet or the cluster doesn't support
  Search, so correctness never depends on it.
- **`AMBER_HAMMING_THRESHOLD = 10`** (`src/mongo.ts`) is a placeholder — ROADMAP Rung 2's real
  Instagram round-trip experiment hasn't been run yet. 10 is picked conservatively from
  `tests/phash.test.ts`'s synthetic evidence (derivatives measure ≤8, unrelated images ≥16).
- **`POST /verify`** (`src/server.ts`) ties it together: GREEN first (exact chain read) →
  AMBER (`findAmberCandidates`, then **every candidate is re-read from the chain via
  `lookupAttestation` before being returned** — a Mongo-only match is never trusted) → GREY.
  Live-tested: a query phash 3 bits from a real indexed record correctly returns
  `{tier:"amber", hammingDistance:3, record:{...chain-confirmed...}}`.
- **Eventual consistency:** Atlas Search indexes sync asynchronously — a just-written document
  can take ~5-10s (observed on the M0 tier) before `$vectorSearch` finds it. Never causes a
  false AMBER (a not-yet-synced candidate just falls through to GREY), only a delayed one.

## Wired into the app

[lib/registry.ts](../lib/registry.ts)'s `attestPhoto` and `recentAttestations` call the backend
only when `EXPO_PUBLIC_USE_FAKE_REGISTRY=false` is set — see [lib/config.ts](../lib/config.ts).
Default is the fake path (safe default; flip explicitly once this backend is reachable from the
device). Android emulator: use `EXPO_PUBLIC_BACKEND_URL=http://10.0.2.2:8787` (not `localhost`).
