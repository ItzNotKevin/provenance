/**
 * Same battery as gallery-report.ts, but against real downloaded stock photographs (actual
 * camera JPEGs, not synthetic SVG renders) — to rule out synthetic-image artifacts skewing the
 * pHash results. Exploratory, not committed to the test suite.
 *
 * Run: node scripts/gallery-report-stock.ts   (backend server must be running: npm start)
 */
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import sharp from "sharp";
import { canonicalManifestBytes, bytesToHex } from "../../lib/manifest.ts";
import { pHashFromRgba } from "../../lib/phash.ts";

const API = process.env.API_URL ?? "http://localhost:8787";
const SCRATCH = "/private/tmp/claude-501/-Users-alancai-Documents-provenance/1b7875ea-8d2f-4828-ad6b-313986af3b86/scratchpad";
const STOCK_DIR = `${SCRATCH}/stock`;
const OUT_HTML = process.env.OUT_HTML ?? `${SCRATCH}/gallery-report-stock.html`;

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
  if (res.status === 409) return { sha256 };
  const body: any = await res.json();
  if (!res.ok) throw new Error(`attest failed (${res.status}): ${JSON.stringify(body)}`);
  console.log(`  tx: ${body.txSignature}`);
  return { sha256 };
}

async function verifyOnce(sha256: string, phash: string) {
  const res = await fetch(`${API}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha256, phash }),
  });
  const body: any = await res.json();
  if (res.status >= 500) throw new Error(`verify ${res.status}: ${JSON.stringify(body)}`);
  return {
    tier: (body.tier ?? "grey") as "green" | "amber" | "grey",
    hammingDistance: body.hammingDistance as number | undefined,
    matchedSha256: body.record?.sha256 as string | undefined,
  };
}

async function verify(imageBuf: Buffer) {
  const sha256 = sha256Hex(imageBuf);
  const phash = await phashOf(imageBuf);
  try {
    return await verifyOnce(sha256, phash);
  } catch (err) {
    console.warn(`  verify retry after: ${(err as Error).message}`);
    await new Promise((r) => setTimeout(r, 2000));
    return await verifyOnce(sha256, phash);
  }
}

async function addNoise(base: Buffer, w: number, h: number): Promise<Buffer> {
  const noiseRaw = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = Math.floor(Math.random() * 256);
    noiseRaw[i * 4] = v;
    noiseRaw[i * 4 + 1] = v;
    noiseRaw[i * 4 + 2] = v;
    noiseRaw[i * 4 + 3] = 55;
  }
  const noiseImg = await sharp(noiseRaw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return sharp(base).composite([{ input: noiseImg }]).jpeg({ quality: 90 }).toBuffer();
}

interface Card {
  label: string;
  group: string;
  tier: string;
  distance: number | null;
  matchOk: boolean;
  dataUri: string;
}

async function thumbDataUri(buf: Buffer): Promise<string> {
  const thumb = await sharp(buf).resize({ width: 240 }).jpeg({ quality: 55 }).toBuffer();
  return `data:image/jpeg;base64,${thumb.toString("base64")}`;
}

async function buildCard(group: string, label: string, buf: Buffer, originalSha256: string | null): Promise<Card> {
  const v = await verify(buf);
  const matchOk = originalSha256 === null || v.tier !== "amber" || v.matchedSha256 === originalSha256;
  return {
    label,
    group,
    tier: v.tier,
    distance: v.hammingDistance ?? null,
    matchOk,
    dataUri: await thumbDataUri(buf),
  };
}

async function main() {
  mkdirSync(SCRATCH, { recursive: true });

  const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
  if (!health) throw new Error(`backend not reachable at ${API} — is 'npm start' running in backend/?`);

  const files = readdirSync(STOCK_DIR).filter((f) => f.endsWith(".jpg")).sort();
  if (files.length === 0) throw new Error(`no .jpg files found in ${STOCK_DIR}`);

  const photos = await Promise.all(
    files.map(async (f, i) => ({
      label: `Stock ${i + 1} (${f})`,
      buf: await sharp(readFileSync(`${STOCK_DIR}/${f}`)).jpeg({ quality: 92 }).toBuffer(),
    }))
  );

  const bySha: Record<string, string> = {};
  for (const p of photos) {
    console.log(`attesting ${p.label}...`);
    const { sha256 } = await attest(p.buf);
    bySha[p.label] = sha256;
    console.log(`  sha256: ${sha256.slice(0, 16)}…`);
  }

  console.log("waiting ~12s for Atlas $vectorSearch index to catch up...");
  await new Promise((r) => setTimeout(r, 12_000));

  const sections: { title: string; cards: Card[] }[] = [];

  for (const p of photos) {
    const originalSha = bySha[p.label];
    const meta = await sharp(p.buf).metadata();
    const w = meta.width!;
    const h = meta.height!;

    const original: Card = await buildCard("Original (attested)", p.label, p.buf, originalSha);

    const composite = async (svg: string) =>
      sharp(p.buf).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 90 }).toBuffer();

    const mild: [string, Buffer][] = [
      ["recompress q40", await sharp(p.buf).jpeg({ quality: 40 }).toBuffer()],
      ["resize down/up", await sharp(p.buf).resize(Math.round(w * 0.5)).resize(w, h).jpeg({ quality: 90 }).toBuffer()],
      ["brightness/contrast", await sharp(p.buf).modulate({ brightness: 1.25 }).linear(1.15, -10).jpeg({ quality: 90 }).toBuffer()],
      ["grayscale", await sharp(p.buf).grayscale().jpeg({ quality: 90 }).toBuffer()],
      ["speckle noise", await addNoise(p.buf, w, h)],
    ];

    const aggressive: [string, Buffer][] = [
      [
        "crop 10%",
        await sharp(p.buf)
          .extract({ left: Math.round(w * 0.1), top: Math.round(h * 0.1), width: Math.round(w * 0.8), height: Math.round(h * 0.8) })
          .jpeg({ quality: 90 })
          .toBuffer(),
      ],
      [
        "heavy crop 50%",
        await sharp(p.buf)
          .extract({ left: Math.round(w * 0.25), top: Math.round(h * 0.25), width: Math.round(w * 0.5), height: Math.round(h * 0.5) })
          .jpeg({ quality: 90 })
          .toBuffer(),
      ],
      ["rotate 5°", await sharp(p.buf).rotate(5, { background: "#000000" }).jpeg({ quality: 90 }).toBuffer()],
      ["rotate 90°", await sharp(p.buf).rotate(90).jpeg({ quality: 90 }).toBuffer()],
    ];

    const overlays: [string, Buffer][] = [
      [
        "corner watermark (~5%)",
        await composite(
          `<svg width="${w}" height="${h}"><text x="${w - 250}" y="${h - 30}" font-size="34" fill="rgba(255,255,255,0.65)" font-family="sans-serif">SAMPLE</text></svg>`
        ),
      ],
      [
        "bare caption text, no bar (~2%)",
        await composite(
          `<svg width="${w}" height="${h}"><text x="${w * 0.5}" y="${h - 40}" font-size="46" fill="white" stroke="black" stroke-width="3" paint-order="stroke" text-anchor="middle" font-weight="bold" font-family="sans-serif">WHEN IT FINALLY WORKS</text></svg>`
        ),
      ],
      [
        "thin caption bar (~8%)",
        await composite(
          `<svg width="${w}" height="${h}">
             <rect x="0" y="${h * 0.92}" width="${w}" height="${h * 0.08}" fill="black"/>
             <text x="${w * 0.5}" y="${h * 0.975}" font-size="28" fill="white" text-anchor="middle" font-family="sans-serif">WHEN IT FINALLY WORKS</text>
           </svg>`
        ),
      ],
      [
        "meme caption bar (~12%)",
        await composite(
          `<svg width="${w}" height="${h}">
             <rect x="0" y="${h * 0.88}" width="${w}" height="${h * 0.12}" fill="black"/>
             <text x="${w * 0.05}" y="${h * 0.96}" font-size="30" fill="white" font-family="sans-serif">WHEN THE CODE FINALLY COMPILES</text>
           </svg>`
        ),
      ],
      [
        "corner logo block (~20%)",
        await composite(
          `<svg width="${w}" height="${h}">
             <rect x="${w * 0.6}" y="${h * 0.75}" width="${w * 0.4}" height="${h * 0.25}" fill="rgba(0,0,0,0.85)"/>
             <text x="${w * 0.63}" y="${h * 0.9}" font-size="28" fill="white" font-family="sans-serif">@brand</text>
           </svg>`
        ),
      ],
      [
        "top+bottom bars (~35%)",
        await composite(
          `<svg width="${w}" height="${h}">
             <rect x="0" y="0" width="${w}" height="${h * 0.18}" fill="black"/>
             <rect x="0" y="${h * 0.82}" width="${w}" height="${h * 0.18}" fill="black"/>
             <text x="${w * 0.05}" y="${h * 0.12}" font-size="30" fill="white" font-family="sans-serif">TOP CAPTION TEXT HERE</text>
             <text x="${w * 0.05}" y="${h * 0.93}" font-size="30" fill="white" font-family="sans-serif">BOTTOM CAPTION TEXT HERE</text>
           </svg>`
        ),
      ],
      [
        "full-image wash (~100%)",
        await composite(
          `<svg width="${w}" height="${h}">
             <rect x="0" y="0" width="${w}" height="${h}" fill="rgba(0,0,0,0.35)"/>
             <text x="${w * 0.5 - 150}" y="${h * 0.5}" font-size="48" fill="white" font-family="sans-serif">REPOSTED</text>
           </svg>`
        ),
      ],
    ];

    const mildCards: Card[] = [];
    for (const [name, buf] of mild) mildCards.push(await buildCard("Mild edits", `${p.label} — ${name}`, buf, originalSha));
    const aggCards: Card[] = [];
    for (const [name, buf] of aggressive) aggCards.push(await buildCard("Aggressive edits", `${p.label} — ${name}`, buf, originalSha));
    const overlayCards: Card[] = [];
    for (const [name, buf] of overlays) overlayCards.push(await buildCard("Text-overlay probe", `${p.label} — ${name}`, buf, originalSha));

    sections.push({ title: `${p.label}: Original`, cards: [original] });
    sections.push({ title: `${p.label}: Mild edits (expect AMBER)`, cards: mildCards });
    sections.push({ title: `${p.label}: Aggressive edits (expect GREY)`, cards: aggCards });
    sections.push({ title: `${p.label}: Text-overlay probe`, cards: overlayCards });
  }

  const tierColor: Record<string, string> = { green: "#22c55e", amber: "#f59e0b", grey: "#71717a" };

  const cardHtml = (c: Card) => `
    <figure class="card">
      <div class="frame">
        <img src="${c.dataUri}" alt="${c.label}" width="240" />
        <span class="corner tl"></span><span class="corner tr"></span>
        <span class="corner bl"></span><span class="corner br"></span>
      </div>
      <figcaption>
        <div class="label">${c.label}</div>
        <div class="meta">
          <span class="chip" style="--chip:${tierColor[c.tier] ?? "#71717a"}">${c.tier.toUpperCase()}</span>
          <span class="dist">${c.distance !== null ? `Δ${c.distance}` : "—"}</span>
          ${!c.matchOk ? '<span class="warn">MISMATCHED MATCH</span>' : ""}
        </div>
      </figcaption>
    </figure>`;

  const sectionHtml = (s: { title: string; cards: Card[] }) => `
    <section class="section">
      <h2>${s.title}</h2>
      <div class="grid">${s.cards.map(cardHtml).join("")}</div>
    </section>`;

  const html = `<title>Provenance — pHash Test Gallery (Real Stock Photos)</title>
<style>
  :root {
    --bg: #0a0a0b; --surface: #131314; --hairline: #27272a; --primary: #ffffff;
    --dim: #9a9aa0; --green: #22c55e; --amber: #f59e0b; --grey: #71717a;
  }
  :root[data-theme="light"] {
    --bg: #f5f5f4; --surface: #ffffff; --hairline: #e4e4e7; --primary: #0a0a0b; --dim: #52525b;
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      --bg: #f5f5f4; --surface: #ffffff; --hairline: #e4e4e7; --primary: #0a0a0b; --dim: #52525b;
    }
  }
  * { box-sizing: border-box; }
  body {
    background: var(--bg); color: var(--primary);
    font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    margin: 0; padding: 2.5rem 1.5rem 5rem;
  }
  header { max-width: 1100px; margin: 0 auto 2.5rem; }
  header .eyebrow { color: var(--dim); letter-spacing: 0.18em; font-size: 0.7rem; text-transform: uppercase; }
  header h1 { font-size: 1.6rem; margin: 0.4rem 0 0.6rem; font-weight: 600; text-wrap: balance; }
  header p { color: var(--dim); font-size: 0.85rem; max-width: 65ch; line-height: 1.6; margin: 0; }
  .legend { display: flex; gap: 1.25rem; margin-top: 1.25rem; flex-wrap: wrap; }
  .legend span { font-size: 0.72rem; color: var(--dim); display: flex; align-items: center; gap: 0.4rem; }
  .legend .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  main { max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 2.75rem; }
  .section h2 {
    font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.14em; color: var(--dim);
    border-bottom: 1px solid var(--hairline); padding-bottom: 0.6rem; margin: 0 0 1.1rem; font-weight: 500;
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1.1rem; }
  .card { margin: 0; background: var(--surface); border: 1px solid var(--hairline); }
  .frame { position: relative; line-height: 0; }
  .frame img { width: 100%; height: auto; display: block; }
  .corner { position: absolute; width: 10px; height: 10px; border-color: var(--primary); opacity: 0.55; }
  .corner.tl { top: 4px; left: 4px; border-top: 1.5px solid; border-left: 1.5px solid; }
  .corner.tr { top: 4px; right: 4px; border-top: 1.5px solid; border-right: 1.5px solid; }
  .corner.bl { bottom: 4px; left: 4px; border-bottom: 1.5px solid; border-left: 1.5px solid; }
  .corner.br { bottom: 4px; right: 4px; border-bottom: 1.5px solid; border-right: 1.5px solid; }
  figcaption { padding: 0.55rem 0.65rem 0.7rem; }
  .label { font-size: 0.7rem; color: var(--primary); margin-bottom: 0.4rem; line-height: 1.35; }
  .meta { display: flex; align-items: center; gap: 0.5rem; font-size: 0.68rem; font-variant-numeric: tabular-nums; }
  .chip { color: var(--bg); background: var(--chip); padding: 0.1rem 0.4rem; font-weight: 700; letter-spacing: 0.04em; }
  .dist { color: var(--dim); }
  .warn { color: var(--amber); }
</style>
<header>
  <div class="eyebrow">Provenance — AMBER tier verification (real stock photographs)</div>
  <h1>pHash test gallery, round 2: real downloaded JPEGs, not synthetic renders</h1>
  <p>
    Same battery as the first gallery, run against 3 real photographs (Lorem Picsum, actual
    camera JPEGs with EXIF data) instead of generated SVG scenes — to rule out the synthetic
    images being unrepresentative of real photo texture/noise. Every thumbnail was attested to
    real Solana devnet + real MongoDB Atlas, then re-submitted as an edited variant to
    <code>POST /verify</code>. Δ is Hamming distance vs. the original's on-chain pHash
    (AMBER threshold: 10 of 64 bits).
  </p>
  <div class="legend">
    <span><i class="dot" style="background:#22c55e"></i>GREEN — exact chain match</span>
    <span><i class="dot" style="background:#f59e0b"></i>AMBER — perceptual match, chain-confirmed</span>
    <span><i class="dot" style="background:#71717a"></i>GREY — no match</span>
  </div>
</header>
<main>
  ${sections.map(sectionHtml).join("")}
</main>`;

  writeFileSync(OUT_HTML, html, "utf8");
  console.log(`\nwrote gallery: ${OUT_HTML}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
