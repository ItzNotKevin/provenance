#!/usr/bin/env bash
# Deploy the built provenance.so to devnet. Run ./build.sh first.
# Uses the program keypair at target/deploy/provenance-keypair.json (its pubkey is the
# declare_id! in lib.rs) and the CLI wallet at ~/.config/solana/id.json as fee payer.
set -euo pipefail

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
RELEASES="$HOME/.local/share/solana/install/releases"
STABLE="$(ls -d "$RELEASES"/stable-*/solana-release 2>/dev/null | head -1)"
if [ -n "$STABLE" ]; then
  ln -sfn "$STABLE" "$HOME/.local/share/solana/install/active_release"
fi

cd "$(dirname "$0")"
solana config set --url devnet >/dev/null
echo "deployer: $(solana address) | balance: $(solana balance)"

solana program deploy target/deploy/provenance.so \
  --program-id target/deploy/provenance-keypair.json
