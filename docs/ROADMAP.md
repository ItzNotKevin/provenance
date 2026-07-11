# ROADMAP — dependency ladder & task checklist

Ordered by dependency (plan §9). Build top-down; each rung unblocks the next. Check boxes as you go.
**Spine = rungs 1–4 + verifier green/red.** Never cut the spine. Cut order if behind:
embeddings → extension → edit lineage → geohash → amber.

## ✅ Already done (teammate's work)

- [x] Expo app scaffold (expo-router, NativeWind, fonts, dark forensic UI)
- [x] Device Ed25519 keypair in secure store (`lib/deviceKey.ts`)
- [x] Real SHA-256 (native + web) (`lib/registry.ts` → `sha256Bytes`)
- [x] Capture flow UI: photo → hash → sign → "anchor" animation → ANCHORED card
- [x] Verify flow UI: pick photo / paste URL → hash → verdict (green/grey)
- [x] Registry list + record detail UI
- [x] All three verdict tiers rendered in `VerdictView` (amber not yet produced)

## 🔨 To build — in dependency order

### Rung 1 — Chain toolchain spike ✅ DONE (the "only true unknown" — now proven)
- [x] Install Rust + Solana CLI + Anchor (hit + resolved the classic version-mismatch wall — see program/README.md)
- [x] Real program built + deployed to **devnet**, confirmed on explorer (id `EoWdD…jZ8g`)
- [x] Smoke test passes: attest_photo + PDA read-back + duplicate rejection (`program/npm run smoke`)
- [x] Working build recipe captured in `program/build.sh` (bypasses the broken `anchor build`)
- [ ] Get a free Helius/QuickNode **devnet** RPC key (public endpoint works but rate-limits; get key before demo)
- [ ] Fund a persistent fee-payer wallet (current: `FNY6avv7…m3tA`, throwaway devnet key)

### Rung 2 — Instagram round-trip experiment (parallel, no chain needed) → sets amber threshold
- [x] Implement pHash in TS (64-bit DCT) — `lib/phash.ts`, verified by `scripts/phash-check.ts`
- [ ] Post ~5 photos to IG, download, measure Hamming distance original↔round-tripped *(needs a human + IG)*
- [ ] Pick a **conservative** amber threshold (false positive ≫ worse than false miss)

### Rung 3 — Capture spike (parallel) — ✅ done
- [x] Photo → SHA-256 → Ed25519 keypair → signature (already in app)
- [x] pHash placement decided: **backend-computed at ingest** for v1 (see lib/CLAUDE.md); device-signed pHash is v2

### Rung 4 — 🎯 Convergence milestone
- [ ] One photo: phone → backend → devnet, **visible on public explorer**
- [ ] After this, the hackathon is assembly, not research

### Rung 5 — Real Anchor program + TS client
- [x] `attest_photo(...)` instruction — `program/programs/provenance/src/lib.rs` *(skeleton, uncompiled)*
- [x] PDA seeded `["photo", sha256]`; stores sha256, pHash, unix ts, device pubkey, `parent_hash`, slot
- [x] Ed25519 sig verification via instruction-sysvar introspection *(written; MUST be devnet-tested)*
- [x] Reject duplicates (via `init` on the hash-seeded PDA)
- [ ] **Install toolchain + `anchor build`/`deploy` to devnet** (Rung 1 — the real blocker; needs Alan's machine)
- [x] Switch app signing to the canonical fixed-byte layout (see `lib/manifest.ts` → `canonicalManifestBytes`, wired into `app/(tabs)/capture.tsx`)
- [ ] `@solana/web3.js` + Anchor-generated TS client (backend builds the 2-ix tx: ed25519 verify + attest_photo)

### Rung 6 — Backend + verifier (Node/TS, MongoDB Atlas M0)
- [x] Scaffold `backend/` — `POST /attest` validates the device's Ed25519 signature over the
  canonical manifest, then submits the real 2-ix devnet tx (see `backend/README.md`)
- [x] Verified against the live deployed program via `backend/scripts/dry-run.ts`
  (`simulateTransaction`, no funds needed) — IDL, PDA seeds, message layout all correct
- [x] **Fee payer funded:** the *local* default (`~/.config/solana/id.json` = `FNY6avv7…m3tA`,
  `backend/src/config.ts`'s fallback) has ~6.1 SOL on devnet — plenty for the demo. (The
  `9eeGRko…46h` wallet named in `backend/README.md`'s "needs manual funding" section is a
  *different*, stale throwaway key from another machine — not what this backend actually
  loads; README could use a follow-up correction.)
- [ ] Retry logic on submit
- [x] `/lookup/:sha256` — GREEN tier direct PDA read (no DB, no fee payer — pure chain read;
  `backend/src/lookup.ts` → `lookupAttestation`, route in `backend/src/http.ts`). Returns
  `{tier:"green",record}` (200) or `{tier:"grey",sha256}` (404); verified live against devnet
  + offline decode tests, including defensive checks (account owner, sha256-matches-PDA-seed).
  (Note: the *app's* `lookupHash` already reads the chain client-side via `lib/solana.ts`; this
  server endpoint is for the web verifier / extension and is the base for `/verify` amber.)
- [x] Mongo indexing — `backend/src/mongo.ts`. Write-through on every successful `/attest`
  (`indexAfterAttest` in `backend/src/http.ts` re-reads the just-confirmed PDA via
  `lookupAttestation` before indexing, so every doc traces to a confirmed chain read — never
  trusts the write-path input directly). Schema: `{sha256, phash, chainAddress, timestamp,
  device, parentHash, slot, txSignature, explorerUrl, indexedAt}`, upserted by `sha256`.
  Non-fatal on Mongo failure (chain write already succeeded — Mongo is disposable). Verified
  live against the real Atlas cluster + real devnet accounts.
- [x] **pHash-at-ingest.** `POST /attest` accepts an optional `imageBase64` field — the exact
  bytes the device hashed/signed. `computeImagePhash` (`backend/src/http.ts`) re-hashes the
  upload and **rejects it (400) if it doesn't match the already-signed sha256** (the binding
  that ties pHash back to the attested photo despite pHash never being part of the signed
  message), then `computePhashFromImageBytes` (`backend/src/imagePhash.ts`, via `sharp`) computes
  the real pHash, baked into the immutable on-chain record at creation (no "update" instruction
  exists). `lib/registry.ts`'s `attestPhoto` gained an optional `imageBytes` param;
  `app/(tabs)/capture.tsx` passes the already-loaded photo bytes. 30MB body-size cap
  (demo-proofing). Live-tested end to end on real devnet + real Atlas: attested a real image
  (on-chain `phash` came back non-zero), a never-attested recompressed derivative correctly
  AMBER-matched to it, a tampered upload was rejected, a genuinely unrelated image returned GREY.
- [x] **AMBER matching (Atlas Vector Search + Hamming distance)** — `backend/src/phashVector.ts`
  encodes each 16-char hex pHash as a 64-dim `±1` vector (squared Euclidean distance = 4 ×
  Hamming distance, proved in `tests/phashVector.test.ts`), indexed via a real Atlas Vector
  Search index (`npm run create-vector-index`; confirmed working on the M0 free tier).
  `findAmberCandidates` in `backend/src/mongo.ts` runs `$vectorSearch` for fast ANN
  candidate-narrowing, then re-derives the *exact* Hamming distance for the real filter/sort
  (ANN is a speed optimization only), falling back to a full scan if the index isn't ready.
  `AMBER_HAMMING_THRESHOLD = 10` is a conservative placeholder pending the real Rung 2
  experiment.
- [x] **`/verify` with all three tiers + chain-confirmation baked in from the start** —
  `backend/src/http.ts` `handleVerify`: GREEN (exact chain read) → AMBER (`findAmberCandidates`,
  each candidate re-read from the chain via `lookupAttestation` before being returned — a
  Mongo-only match is never trusted, tries the next candidate if one fails to confirm) → GREY
  (404, matching `/lookup`'s convention). Live-verified end-to-end against the real Atlas
  cluster + real devnet data, both with synthetic vectors and with a real attested image
  matched against a real recompressed derivative (see pHash-at-ingest above) —
  `{tier:"amber", hammingDistance:0-3, record:{...chain-confirmed...}}`.
- [x] Reindex script: `backend/scripts/reindex.ts` (`npm run reindex`) — scans
  `getProgramAccounts`, decodes every `PhotoAttestation` via `lookup.ts`'s `decodeAttestation`,
  upserts into Mongo. Makes "the index is fully rebuildable from the chain" literally true;
  verified against the 2 real devnet accounts.
- [x] **Wire the app:** `attestPhoto` and `recentAttestations` in `lib/registry.ts` now call the
  backend behind `EXPO_PUBLIC_USE_FAKE_REGISTRY` (see [../lib/config.ts](../lib/config.ts));
  `recentAttestations` hits `GET /recent` (the Mongo mirror) and maps documents back to the
  exact `AttestationRecord` shape the UI already expects — zero UI changes needed. `lookupHash`
  was already real (client-side, `lib/solana.ts`) — see [../lib/CLAUDE.md](../lib/CLAUDE.md).

### Rung 7 — Verifier in tier order
- [ ] GREEN (needs no DB — buildable the moment the chain works)
- [ ] Tamper demo (falls out free from green)
- [ ] AMBER (threshold from rung 2, side-by-side UI — already designed in `VerdictView`)

### Rung 8 — 🚦 Milestone gate (nothing else starts until this arc works)
- [ ] **capture → GREEN → edit one pixel → RED/GREY**

### Rung 9 — Showstopper layer
- [ ] Chrome extension (MV3) on a controlled demo feed (pixel-mimics Instagram)
- [ ] Seed demo Instagram account (~20 attested photos + AI images)
- [ ] Real-Instagram DOM attempt (**timeboxed ~3h, then retreat without guilt**)
- [ ] Edit lineage (child attestations: "cropped from verified original")

### Rung 10 — Threaded to the end
- [x] Test suite scaffolding: `npm test` (TS: pHash + signing contract) + `npm run test:all` (adds Rust); pre-push hook + GitHub Actions CI — all offline, $0
  - [ ] **Expand coverage as we build** (current suite covers pHash, signing, and the full backend: GREEN lookup, Mongo indexing, AMBER matching, `/verify` three-tier + chain-confirmation, pHash-at-ingest): de-stubbed `lib/registry.ts`'s remaining client paths, new program instructions (edit lineage), extension. Add tests in the same change as each feature.
- [ ] Demo-proofing: HEIC / large files / malformed input / graceful no-match / RPC fallback / loading states (judges WILL try to break it)
- [ ] Pitch script written + rehearsed (2 people: one drives, one narrates)
- [ ] Venue Wi-Fi contingency (RPC retry + cached fallback)

## Stretch (deliberately last / cut first)
- [ ] CLIP embeddings + Atlas Vector Search — **grey/lead tier only, never a verdict**
- [ ] Share-to-verify web page (reliable fallback if extension is flaky)

## Team scaling
- **4 people:** chain / app / backend / frontend+extension
- **3:** merge backend+frontend; extension becomes stretch
- **2:** chain+backend / app+verifier; cut extension, keep share-to-verify as the Instagram act

## Where new code goes (don't pollute the Expo bundle)
- `program/` — Anchor/Rust program
- `backend/` — Node/Next.js API + Mongo + reindex script
- `extension/` — Chrome MV3 extension
- Keep these **out of** `app/` and `components/` — Metro would try to bundle them.
