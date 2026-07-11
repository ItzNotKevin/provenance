# Provenance Camera — VERIFY.SYSTEM

A camera app that cryptographically attests photos **at the moment of capture** and anchors the proof
on **Solana** — so anyone can verify a photo is real even after platforms strip its metadata. We don't
detect AI; we prove *this exact image existed, unmodified, from this device, at this moment.*

Hackathon build. Tracks: **Solana** (primary) + **MongoDB** (structural secondary).

## Docs

- **[CLAUDE.md](CLAUDE.md)** — start here: what's real vs. faked, how to run, conventions, verifying changes.
- **[docs/PLAN.md](docs/PLAN.md)** — full product brief: problem, architecture, pitch, judge Q&A.
- **[docs/ROADMAP.md](docs/ROADMAP.md)** — dependency-ladder task checklist + cut order.
- **[lib/CLAUDE.md](lib/CLAUDE.md)** — the seams: exactly where the fake registry stubs plug into the real chain/backend.

## Run

```bash
npm install
npm start        # then press i / a, or scan the QR in Expo Go
npm run web      # verify-only web build (capture is device-only by design)
```

## Current state

The **Expo mobile app** is built with **real device-side crypto** (Ed25519 signing, SHA-256,
secure-store keys) and a complete forensic UI. Everything past the device — the Solana program, the
backend, MongoDB, the Chrome extension — is **stubbed** in [lib/registry.ts](lib/registry.ts) and is
the work to be continued. See [CLAUDE.md](CLAUDE.md) for the full status table.
