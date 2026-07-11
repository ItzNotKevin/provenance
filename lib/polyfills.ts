import { Platform } from "react-native";
import { Buffer } from "buffer";
import * as ExpoCrypto from "expo-crypto";

// @solana/web3.js expects Node's Buffer global; Metro doesn't provide one.
if (typeof global.Buffer === "undefined") {
  global.Buffer = Buffer;
}

if (Platform.OS !== "web") {
  // Pure-JS URL polyfill: web3.js's Connection parses RPC URLs with the
  // WHATWG URL API, which Hermes doesn't fully implement.
  require("react-native-url-polyfill/auto");

  // @solana/web3.js (and other libs) expect a global Web Crypto `crypto.getRandomValues`.
  // react-native-get-random-values needs native code Expo Go doesn't ship with, so it
  // silently fails to install; expo-crypto's getRandomValues is first-party and does
  // work in Expo Go, so use it to fill the same global slot.
  const globalCrypto = (global as { crypto?: Crypto }).crypto;
  if (!globalCrypto) {
    (global as { crypto?: unknown }).crypto = {};
  }
  const cryptoObj = (global as { crypto: { getRandomValues?: typeof ExpoCrypto.getRandomValues } }).crypto;
  if (typeof cryptoObj.getRandomValues === "undefined") {
    cryptoObj.getRandomValues = ExpoCrypto.getRandomValues;
  }
}
