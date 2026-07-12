/**
 * Manual test harness (not part of the fast suite): attests a few synthetic photos to real
 * devnet + real Atlas, then throws a battery of "basic edit" derivatives at POST /verify to
 * see which land GREEN / AMBER / GREY. Exploratory — not committed to the repo's test suite.
 *
 * Run: node scripts/injection-test.ts   (backend server must be running: npm start)
 */
import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import sharp from "sharp";
import { canonicalManifestBytes, bytesToHex } from "../../lib/manifest.ts";
import { pHashFromRgba, hammingDistanceHex } from "../../lib/phash.ts";

const API = process.env.API_URL ?? "http://localhost:8787";

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function phashOf(buf: Buffer): Promise<string> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return pHashFromRgba(data, info.width, info.height);
}

async function attest(imageBuf: Buffer) {
  const device = nacl.sign.keyPair();
  const sha256 = sha256Hex(imageBuf);
  const timestamp = Math.floor(Date.now() / 1000);
  const devicePubkeyHex = bytesToHex(device.publicKey);
  const message = canonicalManifestBytes(sha256, timestamp, devicePubkeyHex);
  const signature = bytesToHex(nacl.sign.detached(message, device.secretKey));

  const res = await fetch(`${API}/attest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sha256,
      timestamp,
      devicePubkey: devicePubkeyHex,
      signature,
      imageBase64: imageBuf.toString("base64"),
    }),
  });
  const body: any = await res.json();
  if (res.status === 409) {
    // Already attested from a prior run (same deterministic synthetic bytes → same sha256).
    return { sha256, txSignature: "(already attested)", explorerUrl: "(already attested)" };
  }
  if (!res.ok) throw new Error(`attest failed (${res.status}): ${JSON.stringify(body)}`);
  return { sha256, txSignature: body.txSignature, explorerUrl: body.explorerUrl };
}

async function verify(imageBuf: Buffer) {
  const sha256 = sha256Hex(imageBuf);
  const phash = await phashOf(imageBuf);
  const res = await fetch(`${API}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha256, phash }),
  });
  const body: any = await res.json();
  return {
    sha256,
    phash,
    status: res.status,
    tier: body.tier as string,
    hammingDistance: body.hammingDistance as number | undefined,
    matchedSha256: body.record?.sha256 as string | undefined,
  };
}

async function lookup(sha256: string) {
  const res = await fetch(`${API}/lookup/${sha256}`);
  const body: any = await res.json();
  return { status: res.status, tier: body.tier as string };
}

// ---------------------------------------------------------------------------
// Synthetic "photos" — distinct SVG scenes rendered to JPEG so each has a genuinely different
// pHash (not just noise), like a real photo of a different subject.
// ---------------------------------------------------------------------------
function svgPhoto(seed: number, label: string): Buffer {
  const hue = (seed * 83) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue},70%,50%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 120) % 360},70%,30%)"/>
    </linearGradient></defs>
    <rect width="800" height="600" fill="url(#g)"/>
    <circle cx="${150 + seed * 60}" cy="220" r="95" fill="hsl(${(hue + 60) % 360},80%,60%)"/>
    <rect x="430" y="330" width="240" height="170" fill="hsl(${(hue + 200) % 360},60%,40%)"/>
    <polygon points="${100 + seed * 20},560 ${260 + seed * 20},420 ${420 + seed * 20},560" fill="hsl(${(hue + 300) % 360},70%,55%)"/>
    <text x="30" y="60" font-size="40" fill="white" font-family="sans-serif">${label}</text>
  </svg>`;
  return Buffer.from(svg);
}

async function makeBase(seed: number, label: string): Promise<Buffer> {
  return sharp(svgPhoto(seed, label)).jpeg({ quality: 92 }).toBuffer();
}

async function addNoise(base: Buffer, w: number, h: number): Promise<Buffer> {
  const noiseRaw = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = Math.floor(Math.random() * 256);
    noiseRaw[i * 4] = v;
    noiseRaw[i * 4 + 1] = v;
    noiseRaw[i * 4 + 2] = v;
    noiseRaw[i * 4 + 3] = 55; // low alpha — mild speckle, not pure static
  }
  const noiseImg = await sharp(noiseRaw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return sharp(base).composite([{ input: noiseImg }]).jpeg({ quality: 90 }).toBuffer();
}

interface Variant {
  name: string;
  category: string;
  expect: "amber" | "grey";
  buf: Buffer;
}

/**
 * Probes where text-overlay coverage stops matching AMBER — a gradient from a tiny corner
 * watermark up to a near-full-image caption wash, so we can see the actual breakpoint instead
 * of guessing from a single small-watermark sample.
 */
async function makeOverlayProbe(base: Buffer): Promise<{ name: string; coveragePct: number; buf: Buffer }[]> {
  const meta = await sharp(base).metadata();
  const w = meta.width!;
  const h = meta.height!;

  const composite = async (svg: string) =>
    sharp(base).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 90 }).toBuffer();

  return [
    {
      name: "corner_watermark (~5% area)",
      coveragePct: 5,
      buf: await composite(
        `<svg width="${w}" height="${h}"><text x="${w - 250}" y="${h - 30}" font-size="34" fill="rgba(255,255,255,0.55)" font-family="sans-serif">SAMPLE</text></svg>`
      ),
    },
    {
      name: "meme_caption_bar (~12% area, bottom strip)",
      coveragePct: 12,
      buf: await composite(
        `<svg width="${w}" height="${h}">
           <rect x="0" y="${h * 0.88}" width="${w}" height="${h * 0.12}" fill="black"/>
           <text x="${w * 0.05}" y="${h * 0.96}" font-size="30" fill="white" font-family="sans-serif">WHEN THE CODE FINALLY COMPILES</text>
         </svg>`
      ),
    },
    {
      name: "corner_logo_block (~20% area)",
      coveragePct: 20,
      buf: await composite(
        `<svg width="${w}" height="${h}">
           <rect x="${w * 0.6}" y="${h * 0.75}" width="${w * 0.4}" height="${h * 0.25}" fill="rgba(0,0,0,0.85)"/>
           <text x="${w * 0.63}" y="${h * 0.9}" font-size="28" fill="white" font-family="sans-serif">@brand</text>
         </svg>`
      ),
    },
    {
      name: "top_and_bottom_bars (~35% area)",
      coveragePct: 35,
      buf: await composite(
        `<svg width="${w}" height="${h}">
           <rect x="0" y="0" width="${w}" height="${h * 0.18}" fill="black"/>
           <rect x="0" y="${h * 0.82}" width="${w}" height="${h * 0.18}" fill="black"/>
           <text x="${w * 0.05}" y="${h * 0.12}" font-size="30" fill="white" font-family="sans-serif">TOP CAPTION TEXT HERE</text>
           <text x="${w * 0.05}" y="${h * 0.93}" font-size="30" fill="white" font-family="sans-serif">BOTTOM CAPTION TEXT HERE</text>
         </svg>`
      ),
    },
    {
      name: "full_image_wash (~100% area, translucent)",
      coveragePct: 100,
      buf: await composite(
        `<svg width="${w}" height="${h}">
           <rect x="0" y="0" width="${w}" height="${h}" fill="rgba(0,0,0,0.35)"/>
           <text x="${w * 0.5 - 150}" y="${h * 0.5}" font-size="48" fill="white" font-family="sans-serif">REPOSTED</text>
         </svg>`
      ),
    },
  ];
}

async function makeVariants(base: Buffer): Promise<Variant[]> {
  const meta = await sharp(base).metadata();
  const w = meta.width!;
  const h = meta.height!;

  const watermarkSvg = `<svg width="${w}" height="${h}"><text x="${w - 250}" y="${h - 30}" font-size="34" fill="rgba(255,255,255,0.55)" font-family="sans-serif">SAMPLE</text></svg>`;

  return [
    {
      name: "recompress_q40",
      category: "mild — recompression",
      expect: "amber",
      buf: await sharp(base).jpeg({ quality: 40 }).toBuffer(),
    },
    {
      name: "resize_down_up",
      category: "mild — resize",
      expect: "amber",
      buf: await sharp(base).resize(Math.round(w * 0.5)).resize(w, h).jpeg({ quality: 90 }).toBuffer(),
    },
    {
      name: "brightness_contrast",
      category: "mild — tone adjust",
      expect: "amber",
      buf: await sharp(base).modulate({ brightness: 1.25 }).linear(1.15, -10).jpeg({ quality: 90 }).toBuffer(),
    },
    {
      name: "grayscale",
      category: "mild — grayscale",
      expect: "amber",
      buf: await sharp(base).grayscale().jpeg({ quality: 90 }).toBuffer(),
    },
    {
      name: "watermark_text",
      category: "mild — small watermark",
      expect: "amber",
      buf: await sharp(base).composite([{ input: Buffer.from(watermarkSvg) }]).jpeg({ quality: 90 }).toBuffer(),
    },
    {
      name: "mild_noise",
      category: "mild — speckle noise",
      expect: "amber",
      buf: await addNoise(base, w, h),
    },
    {
      name: "crop_10pct",
      category: "aggressive — crop",
      expect: "grey",
      buf: await sharp(base)
        .extract({ left: Math.round(w * 0.1), top: Math.round(h * 0.1), width: Math.round(w * 0.8), height: Math.round(h * 0.8) })
        .jpeg({ quality: 90 })
        .toBuffer(),
    },
    {
      name: "heavy_crop_50pct",
      category: "aggressive — heavy crop",
      expect: "grey",
      buf: await sharp(base)
        .extract({ left: Math.round(w * 0.25), top: Math.round(h * 0.25), width: Math.round(w * 0.5), height: Math.round(h * 0.5) })
        .jpeg({ quality: 90 })
        .toBuffer(),
    },
    {
      name: "rotate_5deg",
      category: "aggressive — small rotation",
      expect: "grey",
      buf: await sharp(base).rotate(5, { background: "#000000" }).jpeg({ quality: 90 }).toBuffer(),
    },
    {
      name: "rotate_90",
      category: "aggressive — 90° rotation",
      expect: "grey",
      buf: await sharp(base).rotate(90).jpeg({ quality: 90 }).toBuffer(),
    },
  ];
}

function fmtRow(cols: string[], widths: number[]): string {
  return cols.map((c, i) => c.padEnd(widths[i])).join(" | ");
}

async function main() {
  const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
  if (!health) throw new Error(`backend not reachable at ${API} — is 'npm start' running in backend/?`);

  console.log(`== Injecting synthetic photos into chain + Mongo (${API}) ==\n`);

  const bases = [
    { label: "Photo A", buf: await makeBase(1, "PHOTO A") },
    { label: "Photo B", buf: await makeBase(2, "PHOTO B") },
    { label: "Photo C", buf: await makeBase(3, "PHOTO C") },
  ];

  const attested: { label: string; sha256: string; buf: Buffer; txSignature: string; explorerUrl: string }[] = [];
  for (const b of bases) {
    const result = await attest(b.buf);
    attested.push({ label: b.label, buf: b.buf, ...result });
    console.log(`attested ${b.label}: sha256=${result.sha256.slice(0, 12)}… tx=${result.txSignature.slice(0, 12)}…`);
  }

  console.log("\nwaiting ~12s for Atlas $vectorSearch index to catch up on the new documents...\n");
  await new Promise((r) => setTimeout(r, 12_000));

  // ---- Exact-match tests (GREEN tier) ----
  console.log("== Exact-match tests ==\n");
  const exactRows: string[][] = [];
  for (const a of attested) {
    const v = await verify(a.buf); // identical bytes → identical sha256
    const l = await lookup(a.sha256);
    const ok = v.tier === "green" && l.tier === "green";
    exactRows.push([a.label, v.tier, l.tier, ok ? "PASS" : "FAIL"]);
  }
  const exactW = [10, 8, 8, 6];
  console.log(fmtRow(["photo", "/verify", "/lookup", "result"], exactW));
  for (const r of exactRows) console.log(fmtRow(r, exactW));

  // ---- Unrelated-image negative control (GREY expected) ----
  const unrelated = await makeBase(99, "UNRELATED");
  const unrelatedVerdict = await verify(unrelated);
  console.log(
    `\nunrelated never-attested photo -> tier=${unrelatedVerdict.tier} ` +
      `(${unrelatedVerdict.tier === "grey" ? "PASS" : "FAIL"})`
  );

  // ---- Edit-category tests (AMBER expected for mild, GREY for aggressive) ----
  console.log("\n== Edit-category tests ==\n");
  const editW = [12, 20, 26, 8, 6, 6];
  console.log(fmtRow(["photo", "edit", "category", "tier", "dist", "result"], editW));

  let pass = 0;
  let total = 0;
  for (const a of attested) {
    const variants = await makeVariants(a.buf);
    for (const variant of variants) {
      const v = await verify(variant.buf);
      const matchedRight = v.tier !== "amber" || v.matchedSha256 === a.sha256;
      const ok = v.tier === variant.expect && matchedRight;
      total++;
      if (ok) pass++;
      console.log(
        fmtRow(
          [
            a.label,
            variant.name,
            variant.category,
            v.tier,
            v.hammingDistance !== undefined ? String(v.hammingDistance) : "-",
            ok ? "PASS" : `FAIL(exp ${variant.expect})`,
          ],
          editW
        )
      );
    }
  }

  console.log(`\n${pass}/${total} edit-category checks matched expectation.`);

  // ---- Text-overlay coverage probe (where does AMBER actually break?) ----
  console.log("\n== Text-overlay coverage probe ==\n");
  const probeW = [12, 42, 8, 6];
  console.log(fmtRow(["photo", "overlay", "tier", "dist"], probeW));
  for (const a of attested) {
    const probes = await makeOverlayProbe(a.buf);
    for (const p of probes) {
      const v = await verify(p.buf);
      const matchedRight = v.tier !== "amber" || v.matchedSha256 === a.sha256;
      console.log(
        fmtRow(
          [a.label, p.name, matchedRight ? v.tier : `${v.tier}(!)`, v.hammingDistance !== undefined ? String(v.hammingDistance) : "-"],
          probeW
        )
      );
    }
  }

  console.log("\nAttested records (devnet explorer):");
  for (const a of attested) console.log(`  ${a.label}: ${a.explorerUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
