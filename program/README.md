# Provenance on-chain program (Anchor / Solana)

One PDA per photo, seeded `["photo", sha256]`. The chain is a content-addressed lookup table:
derive the address from a photo's SHA-256, read the PDA in one RPC call — no search. This is the
integrity anchor for the GREEN tier and the confirmation source for AMBER.

> **Status: ✅ BUILT, DEPLOYED TO DEVNET, and smoke-tested end-to-end** (2026-07-11). The ed25519
> signature introspection — the fiddliest part — is **proven working**: the smoke test signs with a
> real device key, submits the 2-instruction tx, and reads the PDA back, with duplicate rejection.
>
> - **Program id:** `EoWdDXF8NNnHryWFmnJazobruBvHPhZhKRR7YfrWjZ8g` ([explorer, devnet](https://explorer.solana.com/address/EoWdDXF8NNnHryWFmnJazobruBvHPhZhKRR7YfrWjZ8g?cluster=devnet))
> - **First attestation tx:** [`57gRhTcX…8xmUF`](https://explorer.solana.com/tx/57gRhTcXVcynkSsuPyuqs2TpwHuaPuBpJ3Lhnq7wc9HTgapb3cz41GhkZtUnuQscvKAatDkimBpWxfeD8KA8xmUF?cluster=devnet)

## ⚡ Quick start (the recipe that actually works)

```bash
cd program
./build.sh       # builds provenance.so + generates the IDL (do NOT use `anchor build` — see below)
./deploy.sh      # deploys to devnet with the program keypair
npm install      # once, for the test client
npm run smoke    # signs + attests on devnet, reads the PDA back, checks dup rejection
```

## ⚠️ Toolchain gotchas (we hit every one of these — don't re-fight them)

The `build.sh` recipe exists **because `anchor build` does not work** with this toolchain. What bites:

1. **`anchor build` force-downgrades Solana to 1.18.17** (rust 1.75), which **cannot compile modern
   `edition2024` crates** (blake3→digest→block-buffer, zeroize_derive, …). Anchor 0.30.1 hardwires
   this. **Fix: never call `anchor build`.** `build.sh` calls `cargo-build-sbf` directly with the
   modern Agave platform-tools (v1.54, rust ≥1.85), which compile everything with no crate pins.
2. **`avm` and `anchor` keep re-pointing `~/.local/share/solana/install/active_release` at the old
   1.18.17 release.** `build.sh`/`deploy.sh` re-point it back to the `stable-*` (Agave 4.1.1) release
   on every run. If a build suddenly fails with rust-1.75 errors, this symlink flipped again.
3. **`cargo-build-sbf` needs host `cargo` on PATH** (for `cargo metadata`) — the scripts add both
   `~/.cargo/bin` and the solana bin dir.
4. **Lock file v3/v4**: only relevant with the OLD tools; the modern tools handle v4 fine, so a fresh
   `Cargo.lock` is fine. (We delete it in the flailing; not needed with the good recipe.)
5. **IDL**: `anchor idl build` also force-downgrades, so we generate `target/idl/provenance.json`
   deterministically with `scripts/gen-idl.mjs` (Anchor discriminators are just sha256 prefixes).
   **If you change the program's instructions/accounts/types, update `gen-idl.mjs` to match.**
6. **Devnet airdrop is rate-limited** — use https://faucet.solana.com or https://faucet.quicknode.com/solana/devnet.

## Toolchain (the "only true unknown" — do this spike first, ideally Alan)

Version mismatch is the classic beginner wall — pin versions with `avm`.

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
# Anchor via avm
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1 && avm use 0.30.1

solana config set --url devnet
solana-keygen new                 # fee-payer / deploy wallet
solana airdrop 2                  # faucet SOL (devnet, free)
```

## Build / deploy / test

Use the scripts (NOT `anchor build` — see gotchas above):

```bash
cd program
./build.sh        # cargo-build-sbf + gen-idl  → target/deploy/provenance.so, target/idl/provenance.json
./deploy.sh       # solana program deploy to devnet (redeploys to the same program id)
npm run smoke     # end-to-end devnet test (attest_photo + PDA read-back + dup rejection)
```

The IDL at `target/idl/provenance.json` is what the smoke test and the backend's Anchor client import.
There is no `target/types/` (that's an `anchor build` artifact); the TS client reads the JSON IDL
directly (Anchor 0.30 `new Program(idl, provider)`).

**Verified proof of the signature-verification design ✅** — `attest_photo`'s ed25519 introspection
is confirmed working on devnet by `npm run smoke` (see `tests/smoke.ts`). The one remaining app↔chain
gap is the signing format below.

## Signing contract (⚠️ the app must change to match this)

`attest_photo` reconstructs the exact bytes the device signed and confirms the co-submitted Ed25519
verify covered them. The canonical message is a **FIXED byte layout, never JSON**:

```
message = sha256 (32 bytes) ‖ timestamp_i64_LE (8 bytes) ‖ device_pubkey (32 bytes)
```

**Today the capture app signs `JSON.stringify({sha256, timestamp, devicePubkey})`** (see
`app/(tabs)/capture.tsx` → `signManifest`). That will NOT verify on-chain. Before the milestone-gate
demo, switch `signManifest` to sign the fixed byte layout above (and have the backend build the
matching Ed25519 precompile instruction via `@solana/web3.js` `Ed25519Program.createInstructionWithPublicKey`).
This is the app↔chain seam flagged in the root `CLAUDE.md` signing-contract section.

## Transaction shape (client / backend builds this)

Each attestation is ONE transaction with TWO instructions, in order:
1. **Ed25519 precompile verify** — `Ed25519Program.createInstructionWithPublicKey({ publicKey: devicePubkey, message, signature })`.
2. **`attest_photo`** — accounts: `attestation` PDA, `device` (device pubkey), `fee_payer` (backend), `instructions_sysvar`, `system_program`; args: `sha256, phash, timestamp, parent_hash`.

The fee-payer (backend) signs and pays; the user never holds SOL.

## Account: `PhotoAttestation`

| field | type | source | notes |
|---|---|---|---|
| `sha256` | `[u8;32]` | device-signed | the proof; PDA seed |
| `phash` | `u64` | backend-computed at ingest | evidence-only (amber); **not** device-signed in v1 |
| `device_pubkey` | `Pubkey` | device | Ed25519 key = valid Solana address |
| `timestamp` | `i64` | device-signed | claimed capture time (unix s) |
| `parent_hash` | `Option<[u8;32]>` | client | edit lineage ("cropped from verified original") |
| `slot` | `u64` | chain | Solana slot when recorded (chain truth of "when") |
| `bump` | `u8` | chain | PDA bump |

## Scaling path (described, not built)

Merkle-per-device: one PDA per device holding a running Merkle root → constant storage regardless of
photo count. Mention verbally; don't build for the hackathon.
