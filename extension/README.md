# Provenance verify extension (Chrome, Manifest V3)

Right-click any image on the web → **Verify with Provenance** → get a GREEN / AMBER / GREY
verdict card, computed by the same backend `POST /verify` the mobile app uses.

This is the piece that makes the product's core claim tangible: a photo you attested at capture
stays verifiable **even after Instagram/Twitter strip its metadata and re-encode it**. Because
those platforms re-compress everything they serve, a web image almost never hits GREEN (exact
bytes) — it resolves to **AMBER** (perceptual match against the attested original), which is
exactly what the pHash/AMBER tier exists for.

## How it works

1. The context-menu click hands the background worker the image's `srcUrl`.
2. It fetches the actual served bytes, computes the **SHA-256** (for the GREEN chain read) and
   base64-encodes the raw bytes.
3. It POSTs `{ sha256, imageBase64 }` to `http://localhost:8787/verify`. The backend re-hashes
   the bytes to bind them to the sha256, computes the **EXIF-corrected pHash** server-side
   (`backend/src/imagePhash.ts`), does the GREEN → AMBER → GREY lookup, and every AMBER
   candidate is re-confirmed against the chain before it's returned.
4. The worker injects a floating verdict card into the page.

No image is stored anywhere — same as the app, only hashes cross the wire.

## Load it (unpacked)

1. Start the backend: `cd backend && npm start` (listens on `:8787`).
2. Chrome → `chrome://extensions` → toggle **Developer mode** (top-right).
3. **Load unpacked** → select this `extension/` folder.
4. Right-click any image on any page → **Verify with Provenance**.

## Demo script

1. Capture a photo in the app → it anchors on devnet (GREEN).
2. Post that photo to Instagram (or anywhere on the web).
3. Open it in the browser, right-click → **Verify with Provenance** → **AMBER**, matched to your
   on-chain original, with the perceptual distance shown.

## Notes / limits

- **Backend URL is hardcoded** to `http://localhost:8787` in `background.js` — change it there if
  the backend runs elsewhere. `host_permissions` already allows it.
- **Cropping breaks matches, resolution doesn't.** pHash is resolution-invariant, so a smaller
  thumbnail of the same framing still matches. But a *square-cropped* grid thumbnail (different
  framing than the original) can miss — open the full post instead. This is inherent to pHash,
  not a bug (see `lib/phash.ts`).
- **Carousels / overlays are handled.** Instagram (and similar galleries) put a transparent swipe
  overlay over the `<img>`, so a right-click doesn't register as an image. The content script
  (`content.js`) recovers the image sitting under the cursor, so the menu still works there.
  **Caveat:** content scripts only inject into pages loaded *after* the extension — if you loaded
  the extension while an Instagram tab was already open, **reload that tab once**.
- **`blob:` URLs and `<canvas>`-rendered images can't be fetched** (blob URLs are page-scoped;
  canvas has no URL). Those fail safe with a "could not verify" card — never a wrong verdict.
- **Auth/referer-gated CDN images** (some logged-in or hotlink-protected content) can 403 on a
  fresh fetch. Also fails safe.
