import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import nacl from "tweetnacl";

if (Platform.OS !== "web") {
  // react-native-get-random-values needs native code Expo Go doesn't ship with,
  // so tweetnacl's own "no PRNG" fallback throws there. expo-crypto is a
  // first-party module Expo Go does bundle — use it as tweetnacl's RNG source.
  nacl.setPRNG((buffer, length) => {
    const random = Crypto.getRandomBytes(length);
    buffer.set(random);
  });
}

const STORAGE_KEY = "verify_system_device_secret_key";
const WEB_STORAGE_KEY = "verify_system_device_secret_key_b64";

export interface DeviceIdentity {
  publicKey: Uint8Array;
  publicKeyHex: string;
}

let cachedIdentity: { publicKey: Uint8Array; secretKey: Uint8Array } | null =
  null;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;

    result += BASE64_CHARS[b0 >> 2];
    result += BASE64_CHARS[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    result += b1 === undefined ? "=" : BASE64_CHARS[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    result += b2 === undefined ? "=" : BASE64_CHARS[b2 & 0x3f];
  }
  return result;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = BASE64_CHARS.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

async function loadOrCreateKeypair(): Promise<{
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}> {
  if (Platform.OS === "web") {
    const stored =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(WEB_STORAGE_KEY)
        : null;
    if (stored) {
      const secretKey = base64ToBytes(stored);
      const keyPair = nacl.sign.keyPair.fromSecretKey(secretKey);
      return { publicKey: keyPair.publicKey, secretKey: keyPair.secretKey };
    }
    const keyPair = nacl.sign.keyPair();
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(
        WEB_STORAGE_KEY,
        bytesToBase64(keyPair.secretKey)
      );
    }
    return { publicKey: keyPair.publicKey, secretKey: keyPair.secretKey };
  }

  const stored = await SecureStore.getItemAsync(STORAGE_KEY);
  if (stored) {
    const secretKey = base64ToBytes(stored);
    const keyPair = nacl.sign.keyPair.fromSecretKey(secretKey);
    return { publicKey: keyPair.publicKey, secretKey: keyPair.secretKey };
  }
  const keyPair = nacl.sign.keyPair();
  await SecureStore.setItemAsync(
    STORAGE_KEY,
    bytesToBase64(keyPair.secretKey)
  );
  return { publicKey: keyPair.publicKey, secretKey: keyPair.secretKey };
}

async function ensureIdentity(): Promise<{
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}> {
  if (!cachedIdentity) {
    cachedIdentity = await loadOrCreateKeypair();
  }
  return cachedIdentity;
}

/** Returns this device's public identity, generating a keypair on first launch. */
export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  const { publicKey } = await ensureIdentity();
  return { publicKey, publicKeyHex: bytesToHex(publicKey) };
}

/**
 * Signs a capture manifest with the device's secret key.
 * Native only — the web build is verify-only and never signs.
 */
export async function signManifest(manifestBytes: Uint8Array): Promise<string> {
  if (Platform.OS === "web") {
    throw new Error("Signing is not available on web — capture is device-only.");
  }
  const { secretKey } = await ensureIdentity();
  const signature = nacl.sign.detached(manifestBytes, secretKey);
  return bytesToHex(signature);
}

export function truncatePubkey(hex: string): string {
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`;
}
