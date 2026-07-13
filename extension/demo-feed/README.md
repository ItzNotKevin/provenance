# Demo feed ("Fauxtogram")

A controlled Instagram-style feed for demoing the extension's badge scanner. Drop images into
`images/`, run the server, open the page with the extension loaded — every post gets a live
GREEN / AMBER / GREY badge with zero clicks (the page carries
`<meta name="provenance-demo-feed">`, which `badges.js` auto-enables on).

Why a mimic feed and not real Instagram? Control. This server delivers images **byte-exact**
(no re-encoding, no auth-gated CDN, no `blob:` URLs), so the GREEN tier is actually reachable
and the demo can't be broken by a platform change five minutes before judging. The same scanner
also runs on real pages via the popup's **SCAN THIS PAGE** toggle — that's the stretch demo,
this is the reliable one.

## Run

```bash
node serve.mjs        # from this directory — no dependencies, serves http://localhost:8788
```

## Stage the three-badge demo

With the backend running (`cd backend && npm start`):

```bash
# 1. GREEN — attest an original, then drop the SAME file into images/
node backend/scripts/attest-file.ts ~/Pictures/original.jpg
cp ~/Pictures/original.jpg extension/demo-feed/images/

# 2. AMBER — a recompressed/resized copy of the attested original (different bytes, same look)
sips -Z 800 ~/Pictures/original.jpg --out extension/demo-feed/images/original-repost.jpg

# 3. GREY — any unrelated photo, straight into images/
cp ~/Pictures/unrelated.jpg extension/demo-feed/images/
```

Reload the feed: three posts, three different badges. Click a badge for the full verdict card
(perceptual distance, capture time, Solana Explorer link).

Notes:
- AMBER requires Mongo/Atlas Vector Search to be configured on the backend (see
  `backend/README.md`); without it, recompressed copies resolve GREY.
- Filenames sort the feed; prefix with `01-`, `02-`, … to control post order.
- Square-cropping an image (different framing) can defeat the perceptual match — that's inherent
  to pHash, so use resize/recompress for the AMBER exhibit, not crops.
