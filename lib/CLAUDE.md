# lib/CLAUDE.md — the seams between the real app and the (currently fake) registry

This directory is the boundary between the device and the world. Two files:

- **`deviceKey.ts` — REAL, done, don't rewrite.** Ed25519 keypair via `tweetnacl`, persisted in
  `expo-secure-store` (native) / `localStorage` (web). Generates on first launch, never leaves the
  device. `signManifest` signs on native; **throws on web by design** (web is verify-only).
  Hand-rolled base64 (no external dep) — leave it unless you have a reason.
- **`registry.ts` — HALF REAL.** `sha256Bytes` is real (Web Crypto on web, expo-crypto on native).
  The three registry functions below are **mocks**. Turning them real = "continuing the work."

## The three stubs (this is where the chain/backend plug in)

All three currently `setTimeout` and return fake data. They already carry `TODO` comments. Keep the
**exact same signatures and return types** when you make them real — every screen imports these, so a
stable interface means the UI needs zero changes when the backend lands.

### 1. `lookupHash(hash) → Verdict` — the GREEN/AMBER/GREY verdict (verify.tsx, record/[hash].tsx)

**Fake now:** returns `green` if the hash ends in an even hex digit, else `grey`. No amber ever.

**Real target (plan §3.3 "three-tier verdict logic"):**
- **GREEN** — derive the on-chain PDA address from the SHA-256 (seeds `["photo", sha256]`), read it
  directly from Solana. Match ⇒ green. **No database in this tier** — pure chain read, unforgeable.
- **AMBER** — ask the backend to pHash-match candidates in Mongo, then **read each candidate's PDA
  from the chain to confirm before display** (Mongo proposes, chain disposes). Return the confirmed
  original for the side-by-side. The amber `VerdictView` layout already exists and expects
  `verdict.record` populated with the attested original (incl. `thumbnailUri`).
- **GREY** — no match. Never a judgment of authenticity; a lead, not a verdict.

**Iron rule to preserve:** every field displayed must come from a confirmed on-chain PDA read. A fake
DB record must fail chain confirmation (→ no verdict), never become a fake "verified."

### 2. `attestPhoto(manifest, signature) → { txSignature, explorerUrl }` — capture.tsx

**Fake now:** derives a fake tx string from the hash+signature.

**Real target (plan §3.1/§3.2):** POST the signed manifest to the backend. Backend validates the
Ed25519 signature over the exact signed bytes (see the signing contract in root `CLAUDE.md`),
co-signs as **fee payer**, submits `attest_photo(manifest, device_signature)` to the Anchor program
(with retry), which creates the PDA (rejecting duplicates), then indexes into Mongo. Return the real
tx signature + a real `explorer.solana.com/tx/<sig>?cluster=devnet` URL.

### 3. `recentAttestations() → AttestationRecord[]` — registry.tsx, record/[hash].tsx

**Fake now:** 8 hardcoded records (with Google-hosted demo thumbnails).

**Real target:** paginated query against Mongo (which mirrors the chain), or
`getProgramAccounts` filtered by the program. The reindex script (plan §3.3) that rebuilds Mongo by
scanning on-chain accounts is what makes "anyone can rebuild it from the chain" literally true.

> ⚠️ `record/[hash].tsx` currently finds a record by calling `recentAttestations()` and searching the
> array. When real, give it a direct `lookupHash(hash)` / by-hash fetch instead of scanning a list.

## Recommended way to make the swap without breaking the demo

1. Add a config module (e.g. `lib/config.ts`) with the backend base URL + Solana RPC endpoint (grab a
   free Helius/QuickNode **devnet** key so the demo doesn't get rate-limited).
2. Implement real versions **behind the same function signatures**. Consider a `USE_FAKE_REGISTRY`
   flag so you can fall back to mocks if venue Wi-Fi dies mid-demo (plan §11 warns about this — RPC
   retry + cached fallback is part of demo-proofing).
3. Keep the `Platform.OS === "web"` branches: the verifier web build must hash + look up without
   signing.

## pHash (`phash.ts` — DONE, verified)

`phash.ts` is a **pure, platform-agnostic** DCT pHash core (no RN/web imports), verified by
`scripts/phash-check.ts` (`node scripts/phash-check.ts` — derivatives → distance 0, unrelated → 20,
tonal inversion → 63). Same core runs on device, backend (via `sharp`), and web (`pHashFromImageUriWeb`
+ canvas). `hammingDistanceHex(a, b)` is the amber decision metric; threshold comes from the Instagram
round-trip experiment (ROADMAP Rung 2).

**Decision — where pHash is computed (v1):** on the **backend at ingest** from the uploaded JPEG
(`sharp(buf).raw()` → `pHashFromRgba`), **not** signed into the device manifest. Why this is safe:
pHash only drives the **amber** tier, which shows *evidence, not a verdict*, and every amber candidate
is chain-confirmed against the device-**signed** SHA-256 before display — an unsigned pHash can never
produce a false "verified." Rationale: Expo native has no cheap raw-pixel API (would need
`expo-image-manipulator` + a JS image decoder). **v2 upgrade:** compute + sign pHash on-device once
native pixel readback is solved, then add `phash` to `CaptureManifest` **and** the signed bytes.

**✅ Built and live-verified (2026-07-11):** `attestPhoto` in `lib/registry.ts` now accepts an
optional third argument, `imageBytes` — `capture.tsx` passes it the exact bytes `sha256Bytes`
already hashed. It's base64'd and sent as `imageBase64` in the `/attest` POST. The backend
(`backend/src/server.ts` → `computeImagePhash`) **re-hashes the uploaded bytes and rejects the
request if they don't match the already-signed `sha256`** — that's what ties the pHash back to
the cryptographically-attested photo even though the pHash itself is never part of the signed
message — then decodes via `sharp` (`backend/src/imagePhash.ts`) and bakes the real pHash into
the immutable on-chain record at creation (there's no "update pHash" instruction, so it has to
happen before submission). Live-tested end to end on real devnet + real Atlas: attested a real
image (on-chain `phash` came back non-zero, e.g. `9a7fff7fffffffff`), then a never-attested
recompressed derivative correctly matched it via `POST /verify`
(`{tier:"amber", hammingDistance:0, record:{...chain-confirmed...}}`), and a genuinely unrelated
image correctly returned `{tier:"grey"}`. `imageBytes` is optional — omitting it still attests
successfully, just with no findable AMBER evidence for that photo.

## Types you must not casually change (the whole UI depends on them)

```ts
type VerdictTier = "green" | "amber" | "grey";
interface AttestationRecord {
  sha256; capturedAt; devicePubkey; txSignature; explorerUrl; thumbnailUri?;
}
interface Verdict { tier: VerdictTier; record?: AttestationRecord; }
interface CaptureManifest { sha256; timestamp; devicePubkey; }  // add phash/geohash HERE when needed
```

When you add `phash`/`geohash`, add them to `CaptureManifest` **and** to the bytes signed in
`capture.tsx`, so the signature covers the new fields — otherwise they're forgeable.
