#!/usr/bin/env bash
# Working build recipe for the provenance program. USE THIS, NOT `anchor build`.
#
# Why not `anchor build`? Anchor 0.30.1 hard-forces Solana 1.18.17 (rust 1.75), whose
# cargo can't compile today's edition2024 crates (blake3/digest/zeroize_derive/...). We
# bypass the wrapper: build the .so with the modern Agave cargo-build-sbf (platform-tools
# v1.54, rust >=1.85) and generate the IDL ourselves. See README.md "Toolchain gotchas".
set -euo pipefail

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

# avm/anchor keep re-pointing active_release at old Solana 1.18.17. Force it back to the
# newest non-1.18 release we have (the Agave stable-* install) before every build.
RELEASES="$HOME/.local/share/solana/install/releases"
STABLE="$(ls -d "$RELEASES"/stable-*/solana-release 2>/dev/null | head -1)"
if [ -n "$STABLE" ]; then
  ln -sfn "$STABLE" "$HOME/.local/share/solana/install/active_release"
fi

cd "$(dirname "$0")"
echo "toolchain: $(cargo-build-sbf --version | head -1)"

cargo-build-sbf
node scripts/gen-idl.mjs

echo "✓ built target/deploy/provenance.so + target/idl/provenance.json"
