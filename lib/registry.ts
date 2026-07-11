import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import { BACKEND_URL, USE_FAKE_REGISTRY } from "./config";

export type VerdictTier = "green" | "amber" | "grey";

export interface AttestationRecord {
  sha256: string;
  capturedAt: string;
  devicePubkey: string;
  txSignature: string;
  explorerUrl: string;
  thumbnailUri?: string;
}

export interface Verdict {
  tier: VerdictTier;
  record?: AttestationRecord;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Computes the SHA-256 digest of raw bytes.
 * Uses expo-crypto on native, Web Crypto (SubtleCrypto) on web.
 */
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  if (Platform.OS === "web") {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      bytes as unknown as BufferSource
    );
    return bytesToHex(new Uint8Array(digest));
  }
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    bytes as unknown as ArrayBuffer
  );
  return bytesToHex(new Uint8Array(digest));
}

function truncateKey(hex: string): string {
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

/**
 * Looks up a hash in the attestation registry: a real devnet read of the
 * content-addressed PDA (see lib/solana.ts, program/README.md) — no database,
 * the address is derived from the hash. GREEN if the PDA exists, GREY if it
 * doesn't or the RPC is unreachable (never a false positive). AMBER (pHash
 * backend match) isn't wired yet — that needs the Mongo-backed matching
 * described in lib/CLAUDE.md.
 */
export async function lookupHash(hash: string): Promise<Verdict> {
  try {
    const { realLookupHash } = await import("@/lib/solana");
    return await realLookupHash(hash);
  } catch (err) {
    console.warn("lookupHash: chain read failed, reporting grey", err);
    return { tier: "grey" };
  }
}

export interface CaptureManifest {
  sha256: string;
  timestamp: string;
  devicePubkey: string;
}

/**
 * Submits a signed capture manifest for on-chain anchoring. Real path: POSTs to the backend
 * (see backend/src/server.ts), which validates the signature, co-signs as fee payer, and
 * submits attest_photo to devnet. Falls back to a fake tx when USE_FAKE_REGISTRY is set
 * (see lib/config.ts) — e.g. if the backend isn't running or venue Wi-Fi dies mid-demo.
 */
export async function attestPhoto(
  manifest: CaptureManifest,
  signature: string
): Promise<{ txSignature: string; explorerUrl: string }> {
  if (USE_FAKE_REGISTRY) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const seed = manifest.sha256 + signature;
    const txSignature = truncateKey(seed.slice(0, 20) + seed.slice(-20));
    return {
      txSignature,
      explorerUrl: `https://explorer.solana.com/tx/${seed.slice(0, 32)}`,
    };
  }

  const unixSeconds = Math.floor(new Date(manifest.timestamp).getTime() / 1000);
  const response = await fetch(`${BACKEND_URL}/attest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sha256: manifest.sha256,
      timestamp: unixSeconds,
      devicePubkey: manifest.devicePubkey,
      signature,
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `attest failed: HTTP ${response.status}`);
  }
  return { txSignature: body.txSignature, explorerUrl: body.explorerUrl };
}

/**
 * Returns recent attestations for the registry list view.
 * TODO: real chain call — replace with a paginated query against the
 * on-chain attestation program (e.g. getProgramAccounts filtered by owner).
 */
export async function recentAttestations(): Promise<AttestationRecord[]> {
  await new Promise((resolve) => setTimeout(resolve, 400));

  return [
    {
      sha256:
        "8f3c2a91d47e6b05c1a9f2e8d3b7c4a65e90f1d2483b7a6c5d4e3f2a1b0c9d8e",
      capturedAt: "2026-07-11 14:32 UTC",
      devicePubkey: "3vws…fV5Z",
      txSignature: "4vfr…xEw7",
      explorerUrl: "https://explorer.solana.com/tx/4vfrxEw7",
      thumbnailUri:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuBDXxKCflo6ZtKZozeYjA1Y_VmV09bYecxOBFFUGXhhED2oW6mBKhp2oazjY5bzb_CFoDlZiRL2C6RXSHZLaC6BDxhwv-rgvm9ug5e-AnA6zHAL8qNc2e6w12rPji2fKNPcWG7HT6nBTGFcj_o_IrIHsloF24y4nqWZ_DVgNlDk3KKbkBNR4pGl6u1_0iBlJ8ajf1M4UTBgRCJcg-JhuCT0ffdS_tMdGR7-tvIBa5p-kX6F2iP3UMNO",
    },
    {
      sha256:
        "1a9b3f5c7d9e2b4a6c8d0e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f4c2d",
      capturedAt: "2026-07-11 14:15 UTC",
      devicePubkey: "9xkj…mP2Q",
      txSignature: "6nqw…tY3z",
      explorerUrl: "https://explorer.solana.com/tx/6nqwtY3z",
      thumbnailUri:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuDKAY-JtEu_hdlcNV5DdYQuwQwlt5SgXRZabb7ca6PfdaWuAIrWNtLDdn8wphZyAljv1VFqivV_mnLtha5wgmTmjs71F79xg0aRtZYRF95jObM-a9vWl8YmrUp5NA_2bCCuuE5C184G9Ymacfe4BoionLh1zIQ0tpopy_t5icXMtYsWI7trXDKBdg8GYq0anaKKC7SgoaSJVt0Tdr7RDu23zPQcYPRIYEZP1QP1YZB2JSKnBNN2HsK6",
    },
    {
      sha256:
        "5d4e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e",
      capturedAt: "2026-07-11 13:58 UTC",
      devicePubkey: "2bny…kL9W",
      txSignature: "8jrp…qN6v",
      explorerUrl: "https://explorer.solana.com/tx/8jrpqN6v",
      thumbnailUri:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuAIWRpiwWuYukR1_tMCIlmbj6_ZV-rR-Im0ECirvqK5cYQXiGZ3mLGo_5Qk3pV12Nw_WQJGwwqjuNJlpbMkc6CgwD5SmPgFO674BSesqiSSb6H_kT8Nj6SJ1Yc64ZZ_0b8b1Ar3M7DA6Rs-f4IZvxmbUxU1G_TGLttUQYsccTMm50AXU0zN13OGcW0LliUzQldsZifBoA_MxbQvuZdKi0aWmTJ9PDrOeA9oB5yfntv8s-HH5Pa-QF3L",
    },
    {
      sha256:
        "0c2a1b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b",
      capturedAt: "2026-07-11 12:44 UTC",
      devicePubkey: "7qtz…hR4E",
      txSignature: "1cxk…wS8m",
      explorerUrl: "https://explorer.solana.com/tx/1cxkwS8m",
    },
    {
      sha256:
        "3e5f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f",
      capturedAt: "2026-07-11 11:20 UTC",
      devicePubkey: "5pxc…jN1M",
      txSignature: "3vhq…dL2p",
      explorerUrl: "https://explorer.solana.com/tx/3vhqdL2p",
      thumbnailUri:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuCFSuY4Qa-PvacjE6QgQdSkvYzORL9nTgnHB_GgjvvAPsZ9t2FRLRwakNVQpTnp0-r84sf-mu_G5AgS3hO9u1tLEBqY5PpMEjp7iDIuZ4TrIMvizDsgpZym6khNzumnlE0dHyc-6-WpgR9ee2OmsqK3-N7N8fCB7XsPhi3FGPRT_GkXZg1cMCvDoxkc6UNU_w_T3m0vRP3aj-nFVhiZObXxYcC7C4EfAVDc9idJWj-V3hQcrQXT9Q65",
    },
    {
      sha256:
        "6g7h1i2j3k4l5m6n7o8p9q0r1s2t3u4v5w6x7y8z9a0b1c2d3e4f5a6b7c8d9e0f",
      capturedAt: "2026-07-11 09:05 UTC",
      devicePubkey: "1wdf…vC8X",
      txSignature: "7bmz…kF4u",
      explorerUrl: "https://explorer.solana.com/tx/7bmzkF4u",
      thumbnailUri:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuAtkY5kMkem_CyKyQ4GkJx6c9E9A0Nbvgvh16Hj7Dp8CAFpl3wr3Cb0rDGfZkA_kg7xhODEWlAvRLg87CHs5ZvpKpt2Dmc25RtFoENsvdzBqOCiDXJXs2d9N-bxSCJv1pDLWsn-MOhKEui7trq7o_42jOn0R3w9XwOZBdeDasyxCRjMfJ7W6x8YbdVAEJ0xa0CW1ESdv29ejfNnKwdiq-0WbRrscHCuJGpLsyzp2M8OZAGDin0qI9a7",
    },
    {
      sha256:
        "8i9j5k6l7m8n9o0p1q2r3s4t5u6v7w8x9y0z1a2b3c4d5e6f7a8b9c0d1e2f3a4b",
      capturedAt: "2026-07-11 08:30 UTC",
      devicePubkey: "8mkl…gB9T",
      txSignature: "5dtw…hV3n",
      explorerUrl: "https://explorer.solana.com/tx/5dtwhV3n",
      thumbnailUri:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuA0R3XXtLGrB5rrC5we0Cw39znfxzzenLX_i7GYadGmeGQmROx4mEOnHMvQew91gwUAeYdeLvyEiX9_W9SPE5l4bPaZ8b9a1e7kLNO974P0rvvUXC-n1rFaQDVJSaJh_WcA422DyMaqq0xTRvYmYYuYg1Kllo-EL0jo9GFyv7IiMt6GkoQn6DMG8ro1aoGmkutaCXBJ6tgIohX0M17wf_CmlZjrkJZzto8YuobXCk2nWn3YQjwtc3Ht",
    },
  ];
}
