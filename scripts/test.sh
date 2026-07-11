#!/usr/bin/env bash
# Fast test suite — the everyday "did I break anything" gate. Runs OFFLINE and costs $0
# (no Claude / no network). Runs on every push via the pre-push hook and in CI.
#
#   TypeScript unit tests  (pHash + canonical signing contract)   — always
#   Rust program unit tests (canonical_message + account layout)  — if cargo is installed
#
# NOT included here (too slow / needs network + faucet SOL): the devnet smoke test.
# Run that manually:  cd program && npm run smoke
set -euo pipefail
cd "$(dirname "$0")/.."

# git hooks / GUI clients often run with a minimal PATH — make sure cargo is reachable.
export PATH="$HOME/.cargo/bin:$PATH"

echo "▶ TypeScript unit tests"
node --test tests/*.test.ts

if command -v cargo >/dev/null 2>&1; then
  echo "▶ Rust program unit tests"
  ( cd program && cargo test --quiet )
else
  echo "▶ Rust tests skipped (cargo not installed)"
fi

echo "✓ all fast tests passed"
