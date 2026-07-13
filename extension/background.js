/**
 * Provenance verify extension — background service worker (Manifest V3).
 *
 * Flow: right-click any <img> → "Verify with Provenance" → fetch the image's actual served
 * bytes → SHA-256 (for the GREEN exact-match chain read) + send the raw bytes so the backend
 * can compute the EXIF-corrected pHash (for the AMBER perceptual match) → render a floating
 * verdict card on the page.
 *
 * Why this mirrors the mobile app: it hits the same POST /verify endpoint with {sha256,
 * imageBase64} that lib/solana.ts uses, so the three-tier verdict is computed by the same
 * backend logic (see backend/src/http.ts). Instagram/Twitter re-encode everything they serve,
 * so images pulled from the web almost never hit GREEN — the whole point of the AMBER tier is
 * to still recognize them as derivatives of an attested original.
 */

const BACKEND_URL = "http://localhost:8787";
const MENU_ID = "verify-provenance";

chrome.runtime.onInstalled.addListener(() => {
  // contexts: ["all"] (not just "image") so the item still appears on Instagram-style
  // carousels, where a swipe overlay covers the <img> and the click registers as a plain page
  // click with no srcUrl. In that case we ask the content script for the image under the cursor.
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Verify with Provenance",
    contexts: ["all"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;

  let srcUrl = info.srcUrl || null;
  console.log("[Provenance] menu clicked. direct srcUrl:", srcUrl || "(none)");
  let found = null;
  let contentScriptError = null;
  if (!srcUrl) {
    // No direct image (overlay/carousel/background-image case) — ask the content script to find
    // the image sitting under where the user right-clicked.
    try {
      found = await chrome.tabs.sendMessage(tab.id, { type: "provenance:findImage" });
      console.log("[Provenance] content script replied:", found);
      srcUrl = found?.src || null;
    } catch (err) {
      contentScriptError = err?.message || String(err);
      console.warn("[Provenance] content script not reachable (reload the tab?):", contentScriptError);
    }
  }

  if (!srcUrl) {
    // Put the diagnostic on the card itself — Instagram blocks the page console, so this is the
    // only place the user can read *why* it failed without opening the extension's own console.
    let message;
    if (contentScriptError) {
      message = `Content script not loaded on this tab — reload the Instagram tab and try again. (${contentScriptError})`;
    } else if (found && found.imgCount === 0) {
      message = "No <img> elements on this page (image may be in an iframe/canvas). Try opening the photo in its own tab.";
    } else {
      message = `Couldn't locate the image. Scanned ${found?.imgCount ?? "?"} images, none matched (via: ${found?.via ?? "n/a"}). Try right-clicking directly on the photo.`;
    }
    await showOverlay(tab.id, { state: "error", message });
    return;
  }
  void verifyImage(srcUrl, tab.id);
});

async function verifyImage(srcUrl, tabId) {
  await showOverlay(tabId, { state: "loading" });
  try {
    await showOverlay(tabId, await computeVerdict(srcUrl));
  } catch (err) {
    await showOverlay(tabId, { state: "error", message: String(err?.message || err) });
  }
}

/**
 * Verdict service for the badge scanner (content script `badges.js`). A feed page asks for a
 * verdict per visible image, so unlike the one-shot context-menu path this needs a cache (the
 * same CDN URL appears on every rescan) and a concurrency cap (don't fire 30 parallel
 * fetch+verify calls the moment a feed loads).
 */
const verdictCache = new Map(); // srcUrl -> Promise<verdict>
const MAX_CACHE = 300;
const MAX_CONCURRENT = 4;
let activeVerdicts = 0;
const verdictQueue = [];

async function withVerdictSlot(fn) {
  if (activeVerdicts >= MAX_CONCURRENT) {
    await new Promise((resolve) => verdictQueue.push(resolve));
  }
  activeVerdicts++;
  try {
    return await fn();
  } finally {
    activeVerdicts--;
    verdictQueue.shift()?.();
  }
}

function verdictForUrl(srcUrl) {
  let pending = verdictCache.get(srcUrl);
  if (!pending) {
    if (verdictCache.size >= MAX_CACHE) verdictCache.clear();
    pending = withVerdictSlot(() => computeVerdict(srcUrl));
    // Don't cache failures (backend down, CDN 403) — a retry on the next scan should get a
    // fresh chance rather than a memoized error.
    pending.catch(() => verdictCache.delete(srcUrl));
    verdictCache.set(srcUrl, pending);
  }
  return pending;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "provenance:verdict" || typeof msg.src !== "string") return;
  verdictForUrl(msg.src).then(sendResponse, (err) =>
    sendResponse({ state: "error", message: String(err?.message || err) })
  );
  return true; // async sendResponse
});

/**
 * Fetch → SHA-256 → GET /lookup (cheap exact chain read, no upload) → only on a miss, POST
 * /verify with the bytes so the backend can compute the pHash for the AMBER tier. The two-step
 * order matters for feed scanning: GREEN images resolve with a ~zero-byte request instead of a
 * base64 upload per image.
 */
async function computeVerdict(srcUrl) {
  const bytes = await fetchImageBytes(srcUrl);
  const sha256 = await sha256Hex(bytes);

  const lookupRes = await fetch(`${BACKEND_URL}/lookup/${sha256}`);
  let body = await lookupRes.json();
  if (body?.tier !== "green") {
    const verifyRes = await fetch(`${BACKEND_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha256, imageBase64: arrayBufferToBase64(bytes) }),
    });
    body = await verifyRes.json();
    // Both 200 (green/amber) and 404 (grey) carry a `tier`; treat anything else as an error.
    if (!body || typeof body.tier !== "string") {
      throw new Error(body?.error || `unexpected response (HTTP ${verifyRes.status})`);
    }
  }

  return {
    state: "result",
    tier: body.tier,
    sha256,
    hammingDistance: body.hammingDistance,
    capturedAt: formatTimestamp(body.record?.timestamp),
    explorerUrl: body.record?.explorerUrl || null,
  };
}

async function fetchImageBytes(srcUrl) {
  const res = await fetch(srcUrl);
  if (!res.ok) throw new Error(`could not fetch image (HTTP ${res.status})`);
  return await res.arrayBuffer();
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000; // avoid "too many arguments" on String.fromCharCode for large images
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function formatTimestamp(unixSeconds) {
  if (typeof unixSeconds !== "number") return null;
  return new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/**
 * Injects the verdict card into the page. `renderProvenanceOverlay` runs in the page's own
 * context (not the worker's), so it must be fully self-contained — no closures over anything here.
 */
function showOverlay(tabId, data) {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      func: renderProvenanceOverlay,
      args: [data],
    })
    .catch((err) => console.warn("Provenance overlay injection failed:", err));
}

function renderProvenanceOverlay(data) {
  const ID = "provenance-verdict-overlay";
  document.getElementById(ID)?.remove();

  const TIERS = {
    green: { color: "#22c55e", label: "CRYPTOGRAPHICALLY VERIFIED", note: "Exact match — unmodified since capture." },
    amber: { color: "#f59e0b", label: "MATCHES A VERIFIED CAPTURE", note: "Visually the same as an attested original; the file has changed since capture." },
    grey: { color: "#71717a", label: "NO ATTESTATION FOUND", note: "No match in the registry. Not a judgment of authenticity." },
  };

  const card = document.createElement("div");
  card.id = ID;
  Object.assign(card.style, {
    position: "fixed",
    top: "16px",
    right: "16px",
    zIndex: "2147483647",
    width: "320px",
    background: "#131314",
    color: "#fafafa",
    border: "1px solid #27272a",
    borderTop: "6px solid #71717a",
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
    padding: "16px",
    lineHeight: "1.5",
  });

  const close = document.createElement("button");
  close.textContent = "✕";
  Object.assign(close.style, {
    position: "absolute",
    top: "8px",
    right: "10px",
    background: "transparent",
    border: "none",
    color: "#a1a1aa",
    cursor: "pointer",
    fontSize: "13px",
  });
  close.addEventListener("click", () => card.remove());

  const wordmark = document.createElement("div");
  wordmark.textContent = "PROVENANCE";
  Object.assign(wordmark.style, {
    fontSize: "9px",
    letterSpacing: "0.22em",
    color: "#71717a",
    marginBottom: "10px",
  });

  const headline = document.createElement("div");
  const sub = document.createElement("div");
  Object.assign(headline.style, { fontSize: "14px", fontWeight: "700", letterSpacing: "0.04em" });
  Object.assign(sub.style, { fontSize: "11px", color: "#a1a1aa", marginTop: "6px" });

  card.append(close, wordmark, headline, sub);

  if (data.state === "loading") {
    headline.textContent = "CHECKING REGISTRY…";
    sub.textContent = "Hashing image and reading the chain.";
  } else if (data.state === "error") {
    card.style.borderTopColor = "#71717a";
    headline.textContent = "COULD NOT VERIFY";
    sub.textContent = data.message || "Is the Provenance backend running on :8787?";
  } else {
    const t = TIERS[data.tier] || TIERS.grey;
    card.style.borderTopColor = t.color;
    headline.textContent = t.label;
    headline.style.color = t.color;
    sub.textContent = t.note;

    if (data.tier === "amber" && typeof data.hammingDistance === "number") {
      const dist = document.createElement("div");
      dist.textContent = `PERCEPTUAL DISTANCE  ${data.hammingDistance}/64 BITS`;
      Object.assign(dist.style, { fontSize: "10px", color: "#71717a", marginTop: "10px", letterSpacing: "0.08em" });
      card.append(dist);
    }
    if (data.capturedAt) {
      const cap = document.createElement("div");
      cap.textContent = `CAPTURED  ${data.capturedAt}`;
      Object.assign(cap.style, { fontSize: "10px", color: "#71717a", marginTop: "6px", letterSpacing: "0.08em" });
      card.append(cap);
    }
    if (data.explorerUrl) {
      const link = document.createElement("a");
      link.href = data.explorerUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "VIEW ON SOLANA EXPLORER ↗";
      Object.assign(link.style, {
        display: "inline-block",
        marginTop: "12px",
        fontSize: "10px",
        color: t.color,
        textDecoration: "none",
        letterSpacing: "0.08em",
      });
      card.append(link);
    }
  }

  document.documentElement.append(card);
}
