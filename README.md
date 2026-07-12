# Provenance
CUHacking 2026 Winner!!

Provenance is a camera-to-chain photo authenticity system. Every photo is cryptographically signed **at the moment of capture** and anchored to the Solana blockchain — so anyone, anywhere, can later prove that an image is the real, unmodified original.

Unlike AI-detector guesswork, Provenance never guesses. A photo either matches an unforgeable on-chain record, or it doesn't. It doesn't try to spot fakes — it **proves reals**.

## How It Works
- 📸 **Sign at capture:** The app hashes the photo (SHA-256), builds a canonical 72-byte manifest, and signs it with an Ed25519 key that is generated on-device, stored in the hardware secure store, and never leaves the phone.
- ⛓️ **Anchor on-chain:** The backend validates the signature, then submits it to our Solana program, which re-verifies the signature *on-chain* and mints a content-addressed record (PDA seeded by the photo's hash). Duplicates are rejected by construction. Every attestation is visible on the public Solana Explorer.
- 🔍 **Verify anywhere:** Anyone can check a photo — the verifier derives the on-chain address straight from the file's hash and reads the chain directly. No database trust required, no account needed.
- 👁️ **Survives recompression:** A perceptual hash (64-bit DCT pHash) is computed from the exact signed bytes at ingest and baked into the immutable on-chain record — so a recompressed or resized repost can still be traced back to its verified original via MongoDB Atlas Vector Search.
- 🧾 **Rebuildable registry:** The browsable registry is a Mongo mirror of the chain. A reindex script can rebuild it from scratch by scanning on-chain accounts — the chain is always the source of truth.

## The Three-Tier Verdict
Every verification returns exactly one of three honest answers — never a fake "verified":

| Tier | Meaning | Backed by |
|---|---|---|
| 🟢 **GREEN** | Byte-exact match — unmodified since capture | Direct on-chain PDA read |
| 🟠 **AMBER** | Recompressed/resized version of a verified original | pHash vector search, then **chain-confirmed** before display |
| ⚪ **GREY** | No record found — *not* a judgment of authenticity | — |

## Core Workflow
### 1) Capture (app → `CAPTURE` tab)
- Take a photo with the in-app camera (pinch-to-zoom, tap/hold-to-focus, flash).
- Watch the forensic checklist run live: SHA-256 → manifest signed → anchoring to Solana.
- Get the ANCHORED card with the real transaction and a Solana Explorer link.

### 2) Verify (app → `VERIFY` tab)
- Pick a photo or paste an image URL.
- The verifier hashes it, reads the chain, and renders the GREEN / AMBER / GREY verdict — AMBER shows the submitted image side-by-side with the attested original and the perceptual distance.

### 3) Registry (app → `REGISTRY` tab)
- Browse recent attestations (hash, time, device, tx) with verified/unverified status badges; search by hash or device; tap into full record detail.

### 4) Browser extension (`extension/`)
- **Badge scanner:** overlays a live GREEN / AMBER / GREY badge on every photo in a feed - auto-runs on the bundled Instagram-style demo feed (`extension/demo-feed/`), opt-in on any other page via the popup's **SCAN THIS PAGE** toggle. Click a badge for the full verdict card.
- **Right-click** any single image → **Verify with Provenance** → the same GREEN / AMBER / GREY verdict card, with perceptual distance and a Solana Explorer link.

## Tech Stack
- **App:** Expo (React Native) · expo-router · NativeWind · TypeScript
- **Chain:** Solana devnet · Anchor (Rust) program · content-addressed PDAs (`["photo", sha256]`) · Ed25519 precompile verification (deployed program: `EoWdD…jZ8g`)
- **Backend:** Node/TS · MongoDB Atlas + Atlas Vector Search (pHash ANN) · sharp (image decode)
- **Crypto:** SHA-256 · Ed25519 (tweetnacl + expo-secure-store) · 64-bit DCT perceptual hash (our own implementation, shared across device/backend/web)
- **Extension:** Chrome MV3 · feed badge overlay + right-click verify · zero-dependency demo feed server

## Local Setup
### App (Expo)
```bash
npm install
npx expo start          # scan the QR with Expo Go
```

### Backend
```bash
cd backend
npm install
npm start               # POST /attest, /verify, /lookup/:sha256, /recent on :8787
```

### Solana program
Already built and deployed to devnet (`EoWdD…jZ8g`) — nothing to run for the demo.
To rebuild: `cd program && ./build.sh` (see `program/README.md`; don't use `anchor build`).

### Chrome extension
`chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`.
Demo feed: `node extension/demo-feed/serve.mjs` → `http://localhost:8788` (see `extension/demo-feed/README.md` for staging GREEN/AMBER/GREY posts).

### Tests
```bash
npm test                # pHash + signing contract (also runs as a pre-push hook + CI)
cd backend && npm test  # lookup, Mongo indexing, AMBER matching, /verify tiers
```

## Required Environment Variables
For the app (all optional — safe demo defaults):
- `EXPO_PUBLIC_BACKEND_URL` (default `http://localhost:8787`; Android emulator: `http://10.0.2.2:8787`)
- `EXPO_PUBLIC_USE_FAKE_REGISTRY` (default `true`; set `false` to hit the real backend + chain)

For the backend:
- `MONGODB_URI` — MongoDB Atlas connection string (M0 free tier works)
- `SOLANA_RPC_URL` (default: public devnet endpoint; use a free Helius/QuickNode key to avoid rate limits)
- `FEE_PAYER_KEYPAIR_PATH` or `FEE_PAYER_SECRET_KEY` — devnet fee-payer wallet
- `PORT` (default `8787`)

## Docs
- [CLAUDE.md](CLAUDE.md) — what's real vs. faked, conventions, how to verify changes
- [docs/PLAN.md](docs/PLAN.md) — full product brief: problem, architecture, pitch
- [docs/ROADMAP.md](docs/ROADMAP.md) — dependency-ladder checklist + cut order
- [lib/CLAUDE.md](lib/CLAUDE.md) — the app↔chain/backend seams
- [extension/README.md](extension/README.md) — extension usage + demo notes
