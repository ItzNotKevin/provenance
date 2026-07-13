/**
 * Demo feed server (ROADMAP Rung 9's "controlled pixel-mimic feed").
 *
 * Serves an Instagram-style feed built from whatever images sit in ./images/, so the extension's
 * badge scanner has a predictable stage: drop in attested originals (GREEN), recompressed copies
 * (AMBER), and unrelated photos (GREY), and the feed shows all three verdicts at once.
 *
 * Two things make it work as a *controlled* stage, unlike the real Instagram:
 *  - Images are served byte-exact (no re-encoding), so an attested original actually hits GREEN.
 *  - The page carries <meta name="provenance-demo-feed">, which badges.js auto-enables on —
 *    the demo needs zero clicks after page load.
 *
 * Run:  node serve.mjs          (from this directory; no dependencies)
 * Env:  PORT (default 8788)
 */
import { createServer } from "node:http";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, extname, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = join(ROOT, "images");
const PORT = Number(process.env.PORT ?? 8788);

const IMAGE_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

// Deterministic fake accounts/captions, cycled by post index — the demo should look identical
// on every run and every machine.
const USERS = ["maya.captures", "north_shore_dan", "elenawalks", "kojifilm", "tribeca.lens", "sam_outside", "ana.dailies", "petepixels"];
const CAPTIONS = [
  "golden hour hits different",
  "no filter needed",
  "shot on my phone, anchored on-chain",
  "proof or it didn't happen",
  "weekend wander",
  "straight off the camera roll",
  "archive dump",
  "light was unreal today",
];
const TIMES = ["2h", "5h", "9h", "14h", "1d", "2d", "3d", "5d"];

function listImages() {
  if (!existsSync(IMAGES_DIR)) return [];
  return readdirSync(IMAGES_DIR)
    .filter((f) => IMAGE_TYPES[extname(f).toLowerCase()])
    .sort();
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const AVATAR_COLORS = ["#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#22c55e", "#ef4444", "#3b82f6", "#f97316"];

function avatar(user, size) {
  const color = AVATAR_COLORS[USERS.indexOf(user) >= 0 ? USERS.indexOf(user) % AVATAR_COLORS.length : 0];
  return `<span class="avatar" style="width:${size}px;height:${size}px;background:${color}">${esc(user[0].toUpperCase())}</span>`;
}

const ICONS = {
  heart: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  comment: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  share: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
};

function postHtml(file, i) {
  const user = USERS[i % USERS.length];
  const likes = ((i * 137 + 43) % 900) + 12;
  const comments = ((i * 53 + 7) % 40) + 2;
  return `
    <article class="post">
      <header>
        <span class="ring">${avatar(user, 32)}</span>
        <span class="user">${esc(user)}</span>
        <span class="meta">• ${TIMES[i % TIMES.length]}</span>
        <span class="more">···</span>
      </header>
      <img src="/images/${encodeURIComponent(file)}" alt="${esc(file)}" loading="lazy" />
      <div class="actions">
        ${ICONS.heart}${ICONS.comment}${ICONS.share}
        <span class="spacer"></span>
        ${ICONS.bookmark}
      </div>
      <div class="likes">${likes.toLocaleString("en-US")} likes</div>
      <div class="caption"><strong>${esc(user)}</strong> ${esc(CAPTIONS[i % CAPTIONS.length])}</div>
      <div class="comments">View all ${comments} comments</div>
      <div class="add-comment">Add a comment…</div>
    </article>`;
}

function feedHtml() {
  const images = listImages();
  const stories = USERS.map(
    (u) => `<div class="story"><span class="ring">${avatar(u, 56)}</span><span class="story-name">${esc(u.slice(0, 9))}</span></div>`
  ).join("");
  const posts = images.length
    ? images.map(postHtml).join("\n")
    : `<div class="empty">
         <strong>No images yet.</strong>
         <p>Drop .jpg / .png / .webp files into <code>extension/demo-feed/images/</code> and reload.</p>
         <p>For the full three-badge demo: attest an original (<code>node backend/scripts/attest-file.ts photo.jpg</code>),
            add a recompressed copy (<code>sips -Z 800 photo.jpg --out photo-repost.jpg</code>), and add an unrelated photo.</p>
       </div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="provenance-demo-feed" content="1" />
<title>Fauxtogram</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📷</text></svg>" />
<style>
  * { box-sizing: border-box; margin: 0; }
  body { background: #fafafa; color: #262626; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .topbar { position: sticky; top: 0; z-index: 10; background: #fff; border-bottom: 1px solid #dbdbdb; }
  .topbar-inner { max-width: 470px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; }
  .logo { font-family: "Snell Roundhand", "Brush Script MT", cursive; font-size: 26px; font-weight: 700; }
  .topbar svg { color: #262626; }
  .col { max-width: 470px; margin: 0 auto; padding-bottom: 60px; }
  .stories { display: flex; gap: 14px; overflow-x: auto; padding: 14px 8px; background: #fff; border-bottom: 1px solid #efefef; scrollbar-width: none; }
  .stories::-webkit-scrollbar { display: none; }
  .story { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: none; }
  .story-name { font-size: 11px; color: #262626; max-width: 64px; overflow: hidden; text-overflow: ellipsis; }
  .ring { display: inline-flex; padding: 2.5px; border-radius: 50%; background: linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888); }
  .avatar { display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; border: 2px solid #fff; color: #fff; font-weight: 700; font-size: 14px; }
  .post { background: #fff; border: 1px solid #dbdbdb; border-radius: 8px; margin-top: 16px; overflow: hidden; }
  .post header { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
  .post header .ring { padding: 2px; }
  .user { font-size: 14px; font-weight: 600; }
  .meta { font-size: 14px; color: #8e8e8e; }
  .more { margin-left: auto; font-weight: 700; letter-spacing: 1px; color: #262626; }
  .post > img { display: block; width: 100%; max-height: 585px; object-fit: cover; background: #efefef; }
  .actions { display: flex; align-items: center; gap: 14px; padding: 10px 12px 6px; }
  .actions svg { cursor: pointer; }
  .actions .spacer { flex: 1; }
  .likes { padding: 0 12px; font-size: 14px; font-weight: 600; }
  .caption { padding: 4px 12px 0; font-size: 14px; line-height: 1.4; }
  .comments { padding: 6px 12px 0; font-size: 14px; color: #8e8e8e; cursor: pointer; }
  .add-comment { padding: 10px 12px 12px; font-size: 13px; color: #c7c7c7; border-top: 1px solid #efefef; margin-top: 10px; }
  .empty { background: #fff; border: 1px solid #dbdbdb; border-radius: 8px; margin-top: 16px; padding: 28px 24px; font-size: 14px; line-height: 1.6; }
  .empty p { margin-top: 10px; color: #555; }
  .empty code { background: #f4f4f5; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
</style>
</head>
<body>
  <div class="topbar"><div class="topbar-inner"><span class="logo">Fauxtogram</span>${ICONS.heart}</div></div>
  <div class="col">
    <div class="stories">${stories}</div>
    ${posts}
  </div>
</body>
</html>`;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = feedHtml();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(html);
    return;
  }

  if (url.pathname.startsWith("/images/")) {
    // basename() strips any traversal; only files directly in images/ are reachable.
    const name = basename(decodeURIComponent(url.pathname.slice("/images/".length)));
    const type = IMAGE_TYPES[extname(name).toLowerCase()];
    const path = join(IMAGES_DIR, name);
    if (!type || !existsSync(path)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    // readFileSync + single write: images are served byte-exact, which is what makes the
    // GREEN (exact SHA-256) tier reachable from this feed at all.
    const bytes = readFileSync(path);
    res.writeHead(200, { "Content-Type": type, "Content-Length": bytes.length, "Cache-Control": "no-cache" });
    res.end(bytes);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, () => {
  const n = listImages().length;
  console.log(`Fauxtogram demo feed → http://localhost:${PORT}  (${n} image${n === 1 ? "" : "s"} in ./images)`);
});
