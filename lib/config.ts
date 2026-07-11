/**
 * Backend + feature-flag config. Expo inlines `EXPO_PUBLIC_*` env vars at build time — no
 * extra setup needed. Defaults are safe for the demo: fake registry until a backend is
 * actually reachable (see lib/CLAUDE.md "Recommended way to make the swap").
 */

/** Android emulator can't reach `localhost` on the host — use `10.0.2.2`. iOS simulator and web can use `localhost`. */
export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? "http://localhost:8787";

/** Flip to real backend calls once `backend/` is running and reachable from the device. */
export const USE_FAKE_REGISTRY = process.env.EXPO_PUBLIC_USE_FAKE_REGISTRY !== "false";
