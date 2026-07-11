# CLAUDE.md — Provenance Camera (VERIFY.SYSTEM)

> Read this first. It's the single source of truth for what this repo is, how to run it,
> what's real vs. faked, and what to build next. If you touch the registry layer, also read
> [lib/CLAUDE.md](lib/CLAUDE.md). Full product brief lives in [docs/PLAN.md](docs/PLAN.md);
> the actionable task ladder is in [docs/ROADMAP.md](docs/ROADMAP.md).

## What this is (one paragraph)

A camera app that cryptographically attests photos **at the moment of capture** and anchors the
proof on **Solana** — so anyone, forever, can verify a photo is real, even after Instagram strips
every trace of metadata. We don't try to prove an image *isn't* AI (a losing detector arms race);
we prove **this exact image existed, unmodified, at this moment, from this device** — a provable
claim, not a classifier's guess. The chain is the **integrity anchor**, MongoDB is the **search
index** (rebuildable by replaying the chain). Hackathon tracks: **Solana** (primary), **MongoDB**
(structural secondary — Atlas Vector Search for the embedding lead-tier).

## Repo status at a glance

This repo contains the mobile capture/verify app (the `verifysystem` Expo project), the deployed
on-chain program (`program/`), and now a minimal backend (`backend/`). The device-side cryptography
is **real**; `attestPhoto` in `lib/registry.ts` is real too (behind a feature flag — see below), and
`lookupHash` is real (a direct client-side chain read — no backend needed for exact-match lookups,
see `lib/solana.ts`). `recentAttestations` is still faked with `setTimeout` + hardcoded data.
The Chrome extension described in the plan does not exist yet.

| Component | Plan location | State in repo |
|---|---|---|
| Capture app (Expo RN) | §3.1 | ✅ **Built** — camera, real Ed25519 sign, real SHA-256 |
| Device keypair / secure store | §3.1 | ✅ **Built** — `lib/deviceKey.ts` (tweetnacl + secure-store) |
| Verify UI (green/amber/grey) | §3.3 | ✅ **UI built** — but only green/grey are ever produced |
| **Verify: GREEN/GREY lookup** | §3.3 | ✅ **Real** — `lib/solana.ts` reads the PDA directly, no database |
| Registry list + record detail | §3.2 | ✅ **UI built** — list still reads fake data |
| **On-chain Anchor program** | §3.2 | ✅ **Deployed to devnet + smoke-tested** — `program/` (id `EoWdD…jZ8g`) |
| **Backend API** | §3.3 | 🟡 **`POST /attest` built but blocked on funding; `GET /lookup/:sha256` live** — `backend/` (see `backend/README.md`) |
| **pHash core** | §4 | ✅ **Built + verified** — `lib/phash.ts` (`scripts/phash-check.ts` passes) |
| **Amber tier wiring** | §4 | ❌ **Not started** — amber UI exists; needs the pHash + Mongo backend match described in `lib/CLAUDE.md` |
| **Chrome extension** | §3.4 | ❌ **Not started** |
| CLIP embeddings (stretch) | §4 | ❌ Not started (deliberately last) |

**The one file that fakes the world:** [lib/registry.ts](lib/registry.ts). `attestPhoto` calls the
real backend when `EXPO_PUBLIC_USE_FAKE_REGISTRY=false` (see [lib/config.ts](lib/config.ts));
`lookupHash` always calls the real chain read (see [lib/solana.ts](lib/solana.ts)), falling back to
GREY (never a false positive) if the RPC is unreachable. `recentAttestations` is still a mock —
replacing it (a real listing needs either Mongo or a `getProgramAccounts` scan) is the remaining
"continuing the work" for the registry tab. See [lib/CLAUDE.md](lib/CLAUDE.md) for the exact seams
and [backend/README.md](backend/README.md) for the fee-payer funding blocker.

**✅ Live on devnet (2026-07-11):** the on-chain program is deployed and smoke-tested end-to-end
(device signature → ed25519 verify → `attest_photo` → PDA → read-back → dup rejection all pass).
- Program id: `EoWdDXF8NNnHryWFmnJazobruBvHPhZhKRR7YfrWjZ8g` (devnet)
- Build/deploy/test: `cd program && ./build.sh && ./deploy.sh && npm run smoke` — **do NOT use
  `anchor build`** (it force-downgrades Solana to a rust that can't compile modern crates; the
  toolchain war is documented in [program/README.md](program/README.md)).
- **App↔chain signing gap closed:** `app/(tabs)/capture.tsx` now signs the canonical fixed-byte
  layout (`sha256‖timestamp_i64LE‖devicePubkey`) via `lib/manifest.ts` → `canonicalManifestBytes`,
  matching `canonical_message` in `program/programs/provenance/src/lib.rs`. Not yet devnet-tested
  from the real app (still blocked on the backend, which builds the paired Ed25519 precompile
  instruction and submits the transaction — see Rung 6 in `docs/ROADMAP.md`).

## How to run

```bash
npm install
npm start          # Expo dev server; press i / a, or scan QR with Expo Go
npm run ios        # iOS simulator
npm run android    # Android emulator
npm run web        # web build (VERIFY-ONLY — capture is disabled on web by design)
```

- **Camera capture requires a real device or simulator with a camera.** On web, the Capture tab
  renders a "requires the device app" fallback and signing throws by design (`lib/deviceKey.ts`).
- No `.env` / secrets / backend needed today — the app is fully self-contained on fake data.
- There is **no test suite** and **no linter configured**. Verification = run the app and drive the
  flow (see "Verifying changes" below).

## How Claude should work in this repo

- **This is a hackathon build. Bias to a working demo over completeness.** The demo script (§11 of
  the plan) is the target; the "cut order" and "never cut" list (below) govern priorities.
- **Never cut the spine:** capture → chain → green/red verifier. That arc alone is a complete
  project. Everything else is upside.
- **Cut order if behind:** embeddings → extension → edit lineage → geohash → amber.
- **Match the existing code.** It's clean, typed, and consistent — mirror it:
  - TypeScript `strict`. Functional React components + hooks. No class components.
  - Styling is **NativeWind** (`className=`), not `StyleSheet`. Colors/fonts come from
    [tailwind.config.js](tailwind.config.js) — use the semantic tokens (`bg-surface`,
    `text-verdict-green`, `font-mono-bold`), never raw hex in `className`. Raw hex only appears
    inline for the few things Tailwind can't express (dynamic `borderTopColor`, progress widths).
  - Path alias `@/` → repo root (e.g. `@/lib/registry`, `@/components/Header`). Configured in both
    `tsconfig.json` and `babel.config.js` — keep them in sync if you change it.
  - File-based routing via **expo-router** (`app/` dir). Tabs live in `app/(tabs)/`.
  - Crypto must work on **both native and web** — follow the `Platform.OS === "web"` branching
    already in `lib/deviceKey.ts` and `lib/registry.ts` (Web Crypto on web, expo-crypto on native).
- **Don't add heavy deps casually.** Every dep ships to the phone. The design deliberately avoids a
  full base64/crypto library (hand-rolled base64 in `deviceKey.ts`) to stay light.
- **Preserve the aesthetic.** The UI is a deliberate "forensic instrument" look — monospace, hairline
  borders, corner registration marks, uppercase labels, three verdict colors. New UI should look like
  it came off the same bench. See "Design system" below.
- **When you build the chain/backend, they go in NEW top-level dirs** (`program/`, `backend/`,
  `extension/`) so they don't entangle the Expo Metro bundler. Do not put a Node server or Rust
  crate inside `app/` or `components/` — Metro will try to bundle it.
- **Commit/push only when asked.** `main` is the working branch; branch before a PR.

## Verifying changes

**Fast test suite (offline, $0 — no Claude, no network). Run it after any change:**

```bash
npm test          # TypeScript unit tests (pHash + canonical signing contract) — ~0.2s
npm run test:all  # the above + Rust program unit tests (needs cargo) — the full fast suite
```

- A shared **`pre-push` git hook** runs `scripts/test.sh` automatically before every push
  (enabled for everyone by `npm install` → `postinstall` sets `core.hooksPath .githooks`; bypass in
  an emergency with `git push --no-verify`).
- **GitHub Actions CI** (`.github/workflows/ci.yml`) is the authoritative gate on push/PR — can't be
  `--no-verify`'d past. Also free / zero AI credits.
- Tests live in [tests/](tests/) (`*.test.ts`, `node --test`) and inline `#[cfg(test)]` in the program.
  Add a test with the change that needs it. **The devnet smoke test (`cd program && npm run smoke`) is
  NOT in the fast suite** — it needs network + faucet SOL; run it manually when touching the program.

> ⚠️ **Coverage is a starting point, not complete — grow it as the codebase expands.** Today the suite
> covers only the pure logic that exists: the pHash core and the canonical signing contract (+ the
> program's message layout). Whole areas have **no tests yet** and need them as they land: the backend
> (`/verify` three-tier logic, chain-confirmation, Mongo indexing), the real `lib/registry.ts` calls
> once de-stubbed, additional program instructions (edit lineage / `parent_hash`), and the Chrome
> extension. **When you add a feature, add its tests in the same change** — treat a new module without
> tests as unfinished.

Tests don't replace driving the app. For a nontrivial UI/flow change also:
1. `npx tsc --noEmit` for type safety.
2. `npm start`, open on device/simulator, exercise the affected tab.
3. For the core spine, the acceptance arc is the **milestone gate** (plan §9 step 8):
   **capture a photo → get GREEN → change one pixel → get RED/GREY.**

## Repo map

```
app/                       expo-router routes (file = screen)
  _layout.tsx              root stack; loads fonts (JetBrains Mono + Inter), StatusBar
  index.tsx                redirects → /(tabs)/verify
  (tabs)/
    _layout.tsx            custom bottom tab bar + shared Header
    capture.tsx            CAPTURE: camera → SHA-256 → sign → attest (native only)
    verify.tsx             VERIFY (default tab): pick photo/URL → hash → lookup → verdict
    registry.tsx           REGISTRY: searchable list of attestations → record detail
  record/[hash].tsx        record detail screen (green VerdictView for a stored record)
components/                presentational building blocks (all NativeWind)
  Header.tsx               top app bar wordmark + "REGISTRY: SOLANA" chip
  Buttons.tsx              PrimaryButton (solid) / GhostButton (outline)
  LedgerRow.tsx            label-over-value hairline data row
  RegistrationFrame.tsx    L-shaped forensic corner marks around children
  VerdictBlock.tsx         colored 6px top edge + headline + subline
  VerdictView.tsx          full green/amber/grey verdict layout (used by verify + record)
lib/
  deviceKey.ts             Ed25519 keypair (tweetnacl), secure-store persist, signManifest  ← REAL
  registry.ts             sha256Bytes (REAL) + lookupHash/attestPhoto/recentAttestations (FAKE)
  phash.ts                 DCT perceptual hash core for the amber tier (pure)              ← REAL
  manifest.ts              canonical signed-message builder (mirrors the on-chain format)  ← REAL
tests/                     fast offline unit tests (node --test): phash.test.ts, manifest.test.ts
scripts/
  phash-check.ts           node scripts/phash-check.ts — human-readable pHash demo
  test.sh                  full fast suite (TS + Rust); run by the pre-push hook + CI
.githooks/pre-push         runs scripts/test.sh before push (enabled via core.hooksPath)
.github/workflows/ci.yml   CI: TS + Rust tests on push/PR (the authoritative gate)
program/                   Anchor/Solana program (DEPLOYED to devnet)
  programs/provenance/src/lib.rs   attest_photo instruction, PhotoAttestation PDA, ed25519 verify
  build.sh / deploy.sh     the working build/deploy recipe (use these, NOT `anchor build`)
  scripts/gen-idl.mjs      deterministic IDL generator (update if program interface changes)
  tests/smoke.ts           `npm run smoke` — end-to-end devnet attestation test
  README.md                toolchain gotchas, tx shape, signing contract the app must adopt
docs/
  PLAN.md                  full product brief (problem, architecture, pitch, judge Q&A)
  ROADMAP.md               dependency-ladder checklist with checkboxes + cut order
tailwind.config.js         design tokens: colors + font families
global.css                 NativeWind entry (Tailwind directives)
```

## Data & signing contract (get this right before touching the chain)

The capture flow in [app/(tabs)/capture.tsx](app/(tabs)/capture.tsx) builds and signs a manifest.
**The on-chain program and backend must verify the Ed25519 signature over the exact same bytes**, so
this contract is load-bearing:

```ts
// manifest object (current shape — see CaptureManifest in lib/registry.ts)
{ sha256: string, timestamp: string /* ISO */, devicePubkey: string /* 64-hex Ed25519 */ }

// signed bytes = UTF-8 of JSON.stringify(manifest)   ← key order matters!
// signature    = nacl.sign.detached(manifestBytes, secretKey), hex-encoded
```

Notes for whoever wires the chain:
- **`devicePubkey` is a raw Ed25519 public key** (32 bytes, hex). Solana addresses are Ed25519
  pubkeys too, so the device key can *be* a Solana address (base58 of the same 32 bytes) — the phone
  signs its own attestations. Good pitch flex; also means no separate identity key is needed.
- **Canonical serialization is required.** Signing `JSON.stringify(manifest)` is order-dependent. If
  the backend re-serializes to verify, it must produce byte-identical JSON, or move to a fixed field
  concatenation. Consider pinning this before it bites you.
- The manifest has **no `phash` or `geohash` yet**. **Decision (v1):** pHash is computed on the
  **backend at ingest** (not device-signed) — safe because it only feeds the evidence-only amber tier,
  which is always chain-confirmed against the signed SHA-256. See [lib/CLAUDE.md](lib/CLAUDE.md). To
  device-sign pHash/geohash later, add them here **and** to the signed bytes so the signature covers them.
- Fees: the **backend is the fee payer** (sponsored-tx pattern); users never hold SOL.

## Design system (so new UI matches)

- **Fonts:** JetBrains Mono (`font-mono`, `font-mono-medium`, `font-mono-bold`) for
  data/labels/headlines; Inter (`font-sans`, `font-sans-medium`) for prose. Loaded in
  `app/_layout.tsx`; app blocks render until loaded.
- **Palette** (dark only — `userInterfaceStyle: "dark"`): `background #0a0a0b`, `surface #131314`,
  `hairline #27272a` borders everywhere, `primary #ffffff` text/accents. Verdicts:
  `verdict-green #22c55e`, `verdict-amber #f59e0b`, `verdict-grey #71717a`.
- **Motifs:** hairline borders, `RegistrationFrame` corner marks on imagery, a 6px colored top edge
  on verdict cards, uppercase mono labels with `tracking-widest`, monospace hashes shown in full and
  `selectable`.

## The two questions judges will ask (have the answers loaded — full versions in PLAN.md §2, §12)

- **"Why blockchain, not Postgres?"** The product is *not having to trust the operator*. The chain
  gives two things a company DB can't: nobody (including us) can forge/backdate/delete an
  attestation, and verification doesn't depend on trusting our startup exists. Litmus test: *"Could
  the verifier lie if the database lied?"* — **No.** Every displayed fact comes from a confirmed
  on-chain read; a fake DB record fails chain confirmation, a hidden one degrades amber→grey. Mongo
  proposes, chain disposes.
- **"Why Solana?"** ~400ms finality + sub-cent fees make it economical to notarize *every photo at
  the instant of capture* — no batching window during which edits could occur. Answer with numbers.

## Quick facts to keep loaded

- SHA-256 collision odds ~2⁻²⁵⁶ → GREEN tier is unforgeable; one changed pixel = unrecognizable hash.
- pHash: 64-bit DCT-based, ~40 lines; amber threshold = whatever the Instagram round-trip experiment
  measures (tune conservative — a false "verified" is the one unaffordable failure).
- Solana: ~400ms finality, fees fractions of a cent. Devnet is free forever (faucet SOL, real explorer).
- Deliberate scope cuts (state them openly, don't hide them): hardware attestation (Play Integrity /
  App Attest), video/Reels, Merkle-per-device scaling, CLIP embeddings. These are "described, not built."
```
