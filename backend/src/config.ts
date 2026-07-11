import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import anchor from "@coral-xyz/anchor";

const { web3 } = anchor;
const { Keypair } = web3;

export const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
export const PORT = Number(process.env.PORT ?? 8787);

/**
 * Loads the fee-payer keypair, in priority order:
 *   1. FEE_PAYER_SECRET_KEY — JSON array of 64 bytes (same shape as a solana-keygen id.json)
 *   2. FEE_PAYER_KEYPAIR_PATH — path to a keypair JSON file
 *   3. ~/.config/solana/id.json — the local Solana CLI default wallet (dev convenience)
 */
export function loadFeePayer(): InstanceType<typeof Keypair> {
  const inline = process.env.FEE_PAYER_SECRET_KEY;
  if (inline) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(inline)));
  }

  const path = process.env.FEE_PAYER_KEYPAIR_PATH ?? `${homedir()}/.config/solana/id.json`;
  try {
    const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
    return Keypair.fromSecretKey(secret);
  } catch (err) {
    throw new Error(
      `No fee-payer keypair found. Set FEE_PAYER_SECRET_KEY (JSON array) or FEE_PAYER_KEYPAIR_PATH, ` +
        `or place one at ${path}. (${(err as Error).message})`
    );
  }
}
