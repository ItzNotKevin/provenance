/**
 * Devnet configuration for the deployed provenance program.
 * See program/README.md for how it was built and deployed.
 */

export const PROGRAM_ID = "EoWdDXF8NNnHryWFmnJazobruBvHPhZhKRR7YfrWjZ8g";
export const DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const CLUSTER_QUERY = "?cluster=devnet";

/**
 * Sponsored-transaction fee payer, embedded client-side.
 *
 * DEVNET-ONLY DEMO SHORTCUT: there is no backend yet (see lib/CLAUDE.md), so the app
 * itself co-signs and pays for every attestation instead of a server. This key is
 * bundled in the app and funded with devnet-only SOL — anyone who extracts it can only
 * spend worthless devnet SOL, never real funds. This MUST move server-side (the backend
 * co-signer described in lib/CLAUDE.md) before this app ever touches mainnet.
 *
 * Fund it at https://faucet.solana.com (devnet) if the balance runs low —
 * pubkey: 5tP2Kd7EZ5LwoDCMP62vXhFZdoNj1QKnu4TWo7HxSRzd
 */
export const FEE_PAYER_SECRET_KEY = new Uint8Array([
  147, 170, 215, 28, 232, 46, 230, 220, 99, 21, 108, 73, 122, 221, 24, 89, 96, 24, 206,
  105, 113, 209, 243, 167, 123, 248, 27, 60, 154, 183, 127, 28, 72, 152, 69, 43, 242,
  63, 251, 217, 1, 202, 157, 251, 104, 101, 220, 72, 204, 129, 134, 160, 9, 226, 186,
  165, 42, 126, 32, 48, 115, 14, 68, 70,
]);
