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

### Rung 6 — Backend + verifier (Node/TS, Next.js, MongoDB Atlas M0)
- [ ] Validate manifests; co-sign + submit tx as **fee payer**, with retry
- [ ] Index `{sha256, phash, chain_address, timestamp, device, parent_hash}` into Mongo
- [ ] `/verify` with all three tiers + **chain-confirmation baked in from the start**
- [ ] Reindex script: rebuild Mongo by scanning on-chain accounts
- [ ] **Wire the app:** replace the three stubs in `lib/registry.ts` (see [../lib/CLAUDE.md](../lib/CLAUDE.md))

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
  - [ ] **Expand coverage as we build** (current suite only covers pHash + signing): backend `/verify` tiers + chain-confirmation, de-stubbed `lib/registry.ts`, new program instructions (edit lineage), extension. Add tests in the same change as each feature.
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
