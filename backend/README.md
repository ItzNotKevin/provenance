# Provenance backend

Validates a device-signed capture manifest, co-signs as **fee payer**, and submits
`attest_photo` to the deployed devnet program (`EoWdD…jZ8g`). This is the piece that makes
[lib/registry.ts](../lib/registry.ts)'s `attestPhoto` real instead of `setTimeout`-faked — see
[lib/CLAUDE.md](../lib/CLAUDE.md) for the full seam description.

## Status

- ✅ `POST /attest` — validates the Ed25519 signature over the canonical manifest bytes, then
  builds and submits the same 2-instruction transaction as `program/tests/smoke.ts` (Ed25519
  precompile verify + `attest_photo`).
- ✅ `GET /lookup/:sha256` — derives the photo PDA and reads the program-owned account directly
  from devnet. Returns GREEN with decoded chain data, or GREY/404 when the PDA does not exist.
  This read needs neither MongoDB nor a fee-payer key.
- ✅ Verified against the real deployed devnet program via `scripts/dry-run.ts`
  (`simulateTransaction`, no funds required) — IDL loads, PDA derivation matches, canonical
  message bytes match the on-chain program, signature validates. The only failure is
  `AccountNotFound` for the fee payer, because it's unfunded (see below).
- ❌ **Not yet submitted a real transaction** — needs a funded fee-payer wallet (blocked, see
  below) and a non-rate-limited RPC endpoint for sustained use (ROADMAP Rung 1).
- ❌ No Mongo indexing, no `/verify` three-tier endpoint, and no pHash-at-ingest yet.
  Those are the remaining ROADMAP Rung 6 items.

## Fee payer: needs manual funding

A throwaway devnet keypair was generated at `devnet-fee-payer.json` (gitignored — never commit
it). Its pubkey:

```
9eeGRkoPDGQEryN2iEbswsPDcRtqLGx2F1WiGXBny46h
```

Funding it programmatically didn't work from this environment — the direct RPC `requestAirdrop`
is rate-limited/disabled on the public devnet endpoint, and `faucet.solana.com` requires solving
a captcha in a browser. **To unblock:** open https://faucet.solana.com, paste the pubkey above,
request devnet SOL (2 SOL is plenty), then re-run `scripts/dry-run.ts` or start the server — it
should go from `AccountNotFound` to a real transaction. This is the same open item as ROADMAP
Rung 1 "fund a persistent fee-payer wallet."

Also grab a free Helius/QuickNode **devnet** RPC key before the demo (Rung 1) — the public
endpoint used by default (`https://api.devnet.solana.com`) rate-limits under load.

## Run

```bash
cd backend
npm install
npm start                              # API on :8787
npm run typecheck                      # strict TypeScript check
npm test                               # offline chain + HTTP unit tests
```

Env vars (all optional):

| Var | Default | Purpose |
|---|---|---|
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | devnet RPC endpoint |
| `PORT` | `8787` | HTTP port |
| `FEE_PAYER_SECRET_KEY` | — | JSON array of 64 bytes (inline secret key) |
| `FEE_PAYER_KEYPAIR_PATH` | `~/.config/solana/id.json` | path to a keypair file |

For local dev against the throwaway key generated here:

```bash
FEE_PAYER_KEYPAIR_PATH=./devnet-fee-payer.json npm start
```

Requires `program/target/idl/provenance.json` to exist — generate it with
`cd program && ./build.sh` (see `program/README.md`; do **not** use `anchor build`).

Read-only lookup does not require the IDL or a fee-payer key:

```bash
curl http://localhost:8787/lookup/<64-character-sha256>
```

- `200 { "tier": "green", "record": ... }` when the program-owned PDA exists.
- `404 { "tier": "grey", "sha256": ... }` when it does not exist.
- `400` for a malformed SHA-256 and `502` when the Solana RPC is unavailable or returns invalid data.

## Sanity-check without spending SOL

```bash
FEE_PAYER_KEYPAIR_PATH=./devnet-fee-payer.json node scripts/dry-run.ts
```

Signs a fake manifest, builds the real transaction, and `simulateTransaction`s it against the
live devnet program — validates the whole pipeline (IDL, PDA seeds, ed25519 instruction, message
layout) without needing a funded wallet or spending anything.

## Wired into the app

[lib/registry.ts](../lib/registry.ts)'s `attestPhoto` calls `POST {BACKEND_URL}/attest` only when
`EXPO_PUBLIC_USE_FAKE_REGISTRY=false` is set — see [lib/config.ts](../lib/config.ts). Default
is the fake path (safe default; flip explicitly once this backend is reachable from the device).
Android emulator: use `EXPO_PUBLIC_BACKEND_URL=http://10.0.2.2:8787` (not `localhost`).
