/**
 * Devnet configuration for reading the deployed provenance program directly from the
 * client (see lib/solana.ts). Writes go through the backend (backend/src/config.ts),
 * which holds the fee-payer key server-side — reads need no key at all.
 */

export const PROGRAM_ID = "EoWdDXF8NNnHryWFmnJazobruBvHPhZhKRR7YfrWjZ8g";
export const DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const CLUSTER_QUERY = "?cluster=devnet";
