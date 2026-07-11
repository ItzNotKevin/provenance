# Provenance Camera — Full Product Brief

> The complete master plan, preserved in-repo. Operational guidance for building lives in the root
> [CLAUDE.md](../CLAUDE.md); the task ladder lives in [ROADMAP.md](ROADMAP.md). This file is the
> "why" and the pitch — read it to understand the product and answer judges.

**One-liner:** A camera app that cryptographically attests photos at the moment of capture and
anchors the proof on Solana — so anyone, forever, can verify a photo is real, even after Instagram
strips every trace of metadata.

**Tracks:** Solana (primary), MongoDB (legitimate secondary — structural, not decorative).

## 1. The Problem

- Deepfakes make fake images believable, but the deeper, asymmetric damage is the **"liar's
  dividend":** real images become deniable. "That's AI" becomes a universal dismissal for genuine
  evidence — journalism, insurance claims, accountability footage, court exhibits.
- **Detection is a losing arms race:** AI detectors decay as generators improve. Attestation at
  capture sidesteps the race — we don't prove an image isn't AI; we prove **this exact image existed,
  unmodified, at this moment, from this device.** A provable claim, not a classifier's guess.
- **The existing standard (C2PA) fails at the last mile.** C2PA (Adobe/Sony/Nikon/Meta/Google/OpenAI)
  embeds signed "Content Credentials" manifests in file metadata. Two fatal flaws:
  1. **Trivially strippable** — a cottage industry of tools removes C2PA manifests (they live in
     metadata containers/JUMBF boxes, not pixels).
  2. **Platforms destroy it themselves** — Instagram, X, LinkedIn, TikTok recompress uploads through
     pipelines that strip metadata, including C2PA manifests, despite public commitments.
- The industry's identified fix is a **"manifest store"** — credentials in an external repository
  linked by identifier rather than embedded in the file. **Our blockchain registry IS that manifest
  store.** The file carries nothing; the registry knows everything. Stripping can't remove what was
  never embedded.

## 2. Why Blockchain / Why Solana (the two judge questions)

- **Why blockchain (not Postgres)?** The product is *not having to trust the operator*. The chain
  provides two properties a company database can't: (a) nobody — including us — can forge, backdate,
  or delete an attestation; (b) verification doesn't depend on trusting our startup's existence or
  honesty. Every legitimate blockchain use reduces to "unforgeable shared truth"; this is the purest
  form of it.
- **Why Solana specifically?** ~400ms finality and sub-cent fees make it economical to notarize every
  photo at the instant of capture (no batching window during which edits could occur). Answer with
  numbers, not vibes.
- **Ecosystem precedent:** Attest Protocol won the Public Goods Award at the Solana Radar hackathon —
  attestation infrastructure is already recognized as valuable by this ecosystem's judges. We're a
  consumer-facing application of a rewarded primitive.

## 3. Architecture Overview (4 components)

**Design principle:** the chain is the integrity anchor, not the database. Raw truth (hashes,
timestamps, device keys) lives on-chain. Everything searchable lives in MongoDB, which anyone can
rebuild by replaying the chain.

### 3.1 Capture App — React Native + Expo  *(BUILT)*
- `expo-camera` for capture; `expo-crypto` for SHA-256; `expo-secure-store` for key storage.
- **Flow per photo:** capture → SHA-256 of JPEG bytes → compute pHash → build manifest
  `{sha256, phash, timestamp, devicePubkey, geohash?}` → sign with device Ed25519 keypair → POST to
  backend.
- Ed25519 keypair generated on first launch, stored in secure store, never leaves the device. Solana
  natively uses Ed25519, so the device key can literally be a Solana keypair — the phone signs its
  own attestations (pitch flex).
- **Fees:** backend acts as fee payer (sponsored transaction pattern); users never hold SOL.
- **Deliberate scope cut (state openly):** hardware attestation (Play Integrity / App Attest) is the
  production upgrade — app-store config rabbit hole, not weekend scope. "Device-bound keys today;
  hardware attestation slots into this exact field."

### 3.2 On-chain Program — Anchor (Rust), Solana devnet  *(NOT STARTED)*
- One **PDA per photo**, seeded `["photo", sha256]` — the chain becomes a content-addressed lookup
  table. Lookup = derive the address from the hash = one RPC call, no search needed.
- PDA stores: sha256 (32B), pHash (8–32B), unix timestamp, device pubkey, `parent_hash` (nullable,
  for edit lineage).
- One instruction: `attest_photo(manifest, device_signature)` — verifies the Ed25519 signature (via
  ed25519 instruction sysvar introspection — budget time, fiddliest part), rejects duplicates (PDA
  already exists ⇒ fail, so nobody can re-attest someone else's photo later), writes record.
- Deployed to devnet (free forever, real explorer, real transactions, faucet SOL). Mention mainnet
  cost (fractions of a cent per attestation) verbally.
- **Merkle-per-device** (one PDA per device holding a running Merkle root, constant storage
  regardless of photo count) is the described-not-built scaling path.
- Client: `@solana/web3.js` + Anchor-generated TS client.

### 3.3 Backend + Verifier — Node/TypeScript, Next.js, MongoDB Atlas (free M0)  *(NOT STARTED)*
- **Backend:** validates manifests, co-signs + submits transactions (with retry), indexes
  `{sha256, phash, chain_address, timestamp, device, parent_hash}` into Mongo.
- **Three-tier verdict logic** (the security model lives in the wording):
  - 🟢 **GREEN — "Cryptographically verified":** exact SHA-256 match. Hash the submitted bytes fresh →
    derive PDA → read chain directly. **No database in this tier.** Unforgeable (~2⁻²⁵⁶; one changed
    pixel = unrecognizable hash).
  - 🟠 **AMBER — "Consistent with verified capture (recompressed/resized)":** pHash within
    conservative Hamming-distance threshold. Mongo finds candidates → **mandatory chain-confirmation
    read per candidate before display** → side-by-side comparison shown. Strong evidence, not proof.
  - ⚪ **GREY — "No attestation found" / "Resembles a verified capture — cannot confirm derivation":**
    no match, or embedding-resemblance only (stretch tier). A lead for a human, never a verdict.
- **Iron rule: Mongo proposes, chain disposes.** Every displayed fact comes from a confirmed on-chain
  PDA read. Litmus test (recite to judges): *"Could the verifier lie if the database lied?"* — **No.**
  Fake DB record → chain confirmation fails → no verdict. Hidden DB record → amber degrades to grey
  (fail-safe omission), never fake-to-verified.
- A **reindex script** that rebuilds Mongo by scanning the program's on-chain accounts makes "anyone
  could rebuild it from the chain" literally true.
- **pHash matching:** at hackathon scale (hundreds of photos), linear scan + XOR/popcount in app code
  is fine. Neither Postgres nor Mongo natively indexes Hamming distance — say "BK-tree or FAISS at
  scale" if asked.

### 3.4 Chrome Extension — Manifest V3, plain TS  *(NOT STARTED)*
- Content script scans `<img>` elements in a feed → sends URLs to backend `/verify` (backend fetches
  & hashes — sidesteps CORS) → injects verification badge overlay on matches. Debounce scroll, cache
  verdicts per URL.
- **Build against a controlled demo feed page (pixel-mimicking Instagram) first.** Real Instagram DOM
  attempt is a timeboxed bonus (~3h, then retreat without guilt) — lazy loading, signed CDN URLs,
  shifting class names make it brittle by design.
- **Desktop web only** (extensions don't run in the mobile app) — say "desktop extension," don't
  overclaim.
- **Alternative reliable flow shipped first: share-to-verify** (paste post URL / upload saved image →
  verdict page).
- **Video/Reels: explicitly out of scope** ("photos now, video on the roadmap" — transcoding mangles
  video; frame-sampling fingerprints are research, not weekend work).

## 4. Matching Technology Decisions

- **SHA-256** (cryptographic hash): exact-bytes identity. The proof tier.
- **pHash** (perceptual hash, 64-bit DCT-based, ~40 lines): coarse brightness-structure fingerprint.
  Survives recompression/resizing/mild brightness (Instagram round-trip); breaks on crops/rotations/
  big overlays. Its rigidity is a feature — it only matches actual derivatives, making false "yes"
  hard.
- **CLIP embeddings + Atlas Vector Search (STRETCH ONLY):** semantic similarity (~500-dim vectors).
  Deliberately demoted to the grey/lead tier because semantic similarity is the wrong question for
  verification — an AI fake depicting the same scene as a real photo lands nearby in embedding space.
  A false "verified" is the one unaffordable failure. Framing: "pHash answers 'is this the same
  picture'; embeddings answer 'does this look similar' — strict one for verdicts, loose one for
  leads."
- **Calibration:** the pre-hackathon Instagram round-trip experiment (post ~5 photos, download,
  measure pHash Hamming distance original↔round-tripped) sets the amber threshold. Tune conservative:
  false positive ≫ worse than false miss.

## 5. Security Model / Trust Boundaries (rehearsed answers)

- Private keys never leave the phone's secure store. A database match grants nothing, unlocks nothing
  — a false positive's blast radius is "a human saw a suggestion panel," never "a fake acquired
  credentials."
- Green is unforgeable; fuzzy tiers show evidence, not verdicts — calibrated language + displayed
  original side-by-side.
- **Why NOT attach proofs to the file (rejected design):** anything traveling with the file is
  strippable/destroyed by platform pipelines — exactly C2PA's failure we exist to fix. Also: an
  attached credential can be copied next to a different image; only the hash binding inside the signed
  manifest ties a credential to one exact image, and the registry checks that binding.
- **"Matches an attested capture" ≠ "poster is the capturer."** Ownership/identity claims (e.g., a
  photojournalist proving their post is their photo) = device pubkey linked to identity in the
  registry, or a fresh signed statement checked against the on-chain device key. Roadmap, one pitch
  sentence, not weekend scope.
- **Analog hole (name it openly):** photographing a screen showing a fake attests a real photo of a
  fake. Attestation proves sensor capture, not scene truth. Mitigation mention: depth/moiré
  heuristics for screen re-photography. Naming the limit ourselves reads as rigor.
- Device attestation bypassable on rooted devices → attestation confidence levels in the manifest
  (production).

## 6. Adoption Objection (the big one — preempt it in the pitch)

- **Reality:** the system only proves things about photos taken through it; at launch "unverifiable"
  describes ~everything and carries no signal.
- **Reframe:** universal adoption was never the goal — **adoption at the moment proof is needed** is.
  Provenance-needing users know in advance: insurance adjusters, freelance photojournalists (some
  already being falsely AI-labeled and publicly protesting), process servers, landlords (move-in
  inspections), marketplace sellers. **B2B workflow tool (like DocuSign — nobody signs grocery lists
  either), not consumer camera app.** Consumer camera app is a dead-on-arrival business model.
- Within a workflow (one insurance claim's photos), attested-vs-not is meaningful even before the
  wider internet cares.
- **End-state: OS/native-camera integration** — C2PA's hardware push and flagship phones shipping
  content credentials prove the industry believes capture-time provenance is the destination. We demo
  the missing piece: an unstrippable anchor on hardware everyone owns.
- The **in-feed badge doubles as an adoption engine:** verified-real as a status marker (blue-check
  dynamics) — vanity beats prudence.
- **Tiered import (v2):** existing photos ingested with best-effort forensics (EXIF consistency, JPEG
  quantization tables, ELA, PRNU sensor fingerprinting) → confidence score, anchored as "existed in
  this form as of import date." Never let the UI blur tiers — one forged import discovered publicly
  destroys every real attestation's credibility.
- **Note:** regular photo EXIF metadata proves nothing (plain-text, freely editable) — that's why
  capture-time signing is the only trustworthy origin.

## 7. What We Deliberately Rejected (useful context)

- **Chore-bidding roommate app w/ photo proof:** roommates are high-trust; no adversary ⇒ chain is
  decoration. Photo attests the wrong thing (that the photo is unedited, not that the chore is done).
- **Paid-to-not-scroll commitment contracts:** right blockchain shape (self-enforcing penalties) but
  fatal oracle problem — screen-time is self-reported from the device owned by the person incentivized
  to lie ⇒ unforgeable ledger of forgeable claims. Also heavily pre-built in prior crypto hackathons.
- **Provenance Camera's edge over both:** the attested fact (pixel hash) is born digital and signed at
  the source — proof and fact are the same object; no oracle gap.
- **ElevenLabs game-dubbing idea:** charming but wrapper-adjacent, heavy prior art (Skyrim AI voice
  mods), and the track gets ~10x submissions ⇒ bad expected value vs. the thin, high-fit Solana field.
- **Other shortlisted finalists:** webcam Vision Pro recreation (killed by live-demo fragility),
  million-agent on-chain economy (higher ceiling, riskier build), origami compiler (sequential fold
  instructions are open research).

## 8. Free Infrastructure (total cost: $0)

- **Solana devnet** — free forever; airdrop fake SOL via CLI/faucet; real explorer
  (explorer.solana.com, devnet toggle).
- **RPC:** free-tier key from Helius or QuickNode (public devnet endpoint rate-limits — get the key so
  the demo doesn't throttle).
- **MongoDB Atlas M0** — free forever, includes Vector Search.
- **Vercel hobby** — verifier site. **Expo Go** — run the app on phones with no app-store process.
- **Solana Playground** (beta.solpg.io) — browser IDE for the first hello-world, zero local setup.
- **Toolchain:** Rust + Solana CLI + Anchor via `avm` (version manager pins compatible versions —
  version mismatch is the classic beginner wall).

## 9. Build Plan — Dependency Ladder

*(Tracked as checkboxes in [ROADMAP.md](ROADMAP.md).)*

**Pre-hackathon spikes** (~2 evenings; goal: learn nothing new at the event, only assemble):
1. **Chain toolchain** (the only true unknown; ideally Alan): install toolchain → Playground
   hello-world → local toy program writing a hash to a PDA and reading back → deploy to devnet.
2. **Instagram round-trip experiment** (parallel, no chain knowledge): pHash function + 5 photos
   posted/downloaded/measured ⇒ amber threshold. If this fails, we need to know this week.
3. **Capture spike** (parallel): Expo app — photo → SHA-256 → Ed25519 keypair in secure store →
   signature. *(DONE — see repo.)*
4. **Convergence milestone:** one photo phone → backend → devnet, visible on public explorer. When
   this works, the hackathon becomes assembly, not research.

**At the event, in dependency order:**
5. Real Anchor program (`attest_photo` + sig verification + duplicate rejection + `parent_hash` field
   now — cheap to add, expensive to retrofit) → TS client.
6. Production-shape backend: validation, tx submission w/ retry, Mongo indexing, `/verify` with all
   three tiers and chain-confirmation baked in from the start.
7. Verifier in tier order: green (needs no DB — buildable the moment the chain works) → tamper demo
   falls out free → amber (threshold from spike 2, side-by-side UI).
8. **Milestone gate:** capture → green → edit one pixel → red. Nothing else starts until this arc works.
9. **Showstopper layer:** extension on controlled demo feed → seed demo Instagram account (~20
   attested photos + AI images) → real-Instagram DOM attempt (timeboxed 3h) → edit lineage (child
   attestations: "cropped from verified original").
10. **Threaded to the end:** demo-proofing (HEIC/large files/malformed input/graceful no-match/RPC
    fallback/loading states — judges WILL try to break it) + pitch.

**Cut order if behind:** embeddings → extension → edit lineage → geohash → amber.
**Never cut:** capture → chain → green/red verifier (that spine alone is a complete project).

**Team scaling:** 4 = chain / app / backend / frontend+extension. 3 = merge backend+frontend;
extension becomes stretch. 2 = chain+backend / app+verifier; cut extension, keep share-to-verify as
the Instagram act.

## 10. Refinement Priorities ("isn't this too simple / one day with Claude?")

The spine is ~a day; the gap between "happy path works once" and "survives a judge trying to break it"
is where hackathons are won:
1. **Demo-proofing** (highest value/hour).
2. **Extension's in-feed moment** (the showstopper act, most fragile component).
3. **Edit lineage** (elevates "tamper detector" → "provenance system"; answers "what about legitimate
   edits?" with a built feature).
4. **The pitch** (the project's value is ~50% conceptual; the insight is the product).
Skip: Merkle (describe verbally), video, hardware attestation — deliberate, stated simplifications.

## 11. Demo Script (3 minutes)

1. **Problem** — liar's dividend (30s).
2. **Live capture:** photograph the judges → transaction on explorer seconds later (45s).
3. **Tamper:** open the photo, nudge one pixel, verifier flips green → red (30s).
4. **Feed scroll:** demo Instagram account seeded with attested + AI photos; extension badges light up
   on the real one (45s). Provenance surviving an actual platform round-trip — which deployed C2PA
   cannot do.
5. **The argument:** "proof in a registry, not in strippable metadata — Instagram's own pipeline
   strips embedded credentials" (20s).
6. **Preempted adoption objection:** insurance/journalism wedge; verified-real as status marker (10s).

- **Demo roles:** one person drives, one narrates — never the same person.
- Bring a plan for venue Wi-Fi flakiness (RPC retry + cached fallback).

## 12. Rehearsed Judge Q&A

- **"Why not just Postgres?"** → Chain = trust layer (unforgeable, operator-independent), DB = search
  layer; every verdict is chain-confirmed; litmus test: could the verifier lie if the DB lied? No, in
  both directions.
- **"Why Mongo over Postgres?"** → Honest: at this scale either works for the core path; decision =
  document-shaped manifests with growing optional fields + Atlas Vector Search built into the free
  tier for the embedding lead-tier (+ prize eligibility — structural, not decorative). Knowing where
  the choice was principled vs. pragmatic reads as senior.
- **"False positives?"** → Green unforgeable (2⁻²⁵⁶); amber/grey show evidence with calibrated
  language and the displayed original; nothing mints credentials or moves keys; conservative
  thresholds.
- **"Adoption?"** → §6 verbatim.
- **"Analog hole?"** → §5 verbatim — attests sensor capture, not scene truth; we name our limits.
- **"Legitimate edits?"** → Edit lineage: children re-attested with `parent_hash` ⇒ "cropped from
  verified original" chain of custody.
- **"Video?"** → Photos now; frame-fingerprint sequences on the roadmap; transcoding makes it
  research, not a weekend.

## 13. Key Numbers & Facts to Have Loaded

- Solana: ~400ms finality; fees fractions of a cent ⇒ per-photo notarization at capture is
  economically viable (the "why Solana" number-answer).
- SHA-256 collision: ~2⁻²⁵⁶ — green is unforgeable.
- pHash: 64-bit, DCT-based, ~40 lines; threshold = whatever the Instagram round-trip experiment
  measures.
- CLIP embeddings: ~500 dims, ~2KB/image, few hundred ms on CPU — leads only, never verdicts.
- C2PA context: Meta is on the C2PA steering committee and auto-labels via Content Credentials, yet
  platform pipelines strip manifests and stripper tools are a cottage industry — the standard's own
  gap is our opening.
- Precedent: Attest Protocol won Solana Radar's Public Goods Award; ecosystem rewards attestation
  infrastructure.

## 14. Open Threads / Next Deliverables

- Anchor program skeleton (accounts + instructions, Rust) — offered, not yet written.
- pHash TS implementation — offered, not yet written.
- Full pitch script written out — offered, not yet written.
- Mongo schema + vector index config — offered, not yet written.
- Toy PDA program for the first chain spike — offered, not yet written.
