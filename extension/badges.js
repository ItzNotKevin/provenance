/**
 * Badge scanner content script — the "feed overlay" layer (ROADMAP Rung 9).
 *
 * When enabled, it finds every feed-sized <img> on the page, asks the background worker for a
 * three-tier verdict (see `computeVerdict` in background.js), and pins a floating GREEN / AMBER /
 * GREY badge to the image's corner. Clicking a badge opens the full verdict card (explorer link,
 * perceptual distance, capture time).
 *
 * Activation:
 *  - Auto-enables on the controlled demo feed (a page carrying <meta name="provenance-demo-feed">
 *    — see extension/demo-feed/), so the demo works with zero clicks.
 *  - Everywhere else (real Instagram etc.) it stays inert until the popup's "scan this page"
 *    toggle sends `provenance:badgesToggle`. Per-tab, not persisted — a scanner that silently
 *    hashes every image on every page you visit would be creepy; this one only runs where asked.
 *
 * Fail-safe by design: fetch/verify errors render no badge at all — never a wrong verdict.
 */

const MIN_BADGE_SIZE = 100; // px rendered — skips avatars, story rings, icons
const RESCAN_DEBOUNCE_MS = 250;
const LAYOUT_POLL_MS = 400; // catches layout shifts scroll/resize events miss (font load, etc.)

const TIER_STYLE = {
  green: { bg: "#22c55e", fg: "#052e16", dot: "#052e16", label: "VERIFIED" },
  amber: { bg: "#f59e0b", fg: "#451a03", dot: "#451a03", label: "MATCHED" },
  grey: { bg: "rgba(24,24,27,0.78)", fg: "#d4d4d8", dot: "#71717a", label: "UNVERIFIED" },
};

let enabled = false;
let layer = null; // fixed full-page container all badges live in
let mutationObserver = null;
let rescanTimer = null;
let layoutTimer = null;
const tracked = new Map(); // img element -> { badge, src, verdict }

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "provenance:badgesToggle") {
    setEnabled(!enabled);
    sendResponse({ enabled, count: tracked.size });
    return false;
  }
  if (msg?.type === "provenance:badgesStatus") {
    sendResponse({ enabled, count: tracked.size });
    return false;
  }
});

// Zero-click activation on the controlled demo feed.
if (document.querySelector('meta[name="provenance-demo-feed"]')) {
  setEnabled(true);
}

function setEnabled(next) {
  if (next === enabled) return;
  enabled = next;
  if (enabled) {
    ensureLayer();
    scan();
    mutationObserver = new MutationObserver(scheduleRescan);
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset"],
    });
    // capture-phase so nested scroll containers (Instagram's virtualized feed) are seen too
    window.addEventListener("scroll", layout, { capture: true, passive: true });
    window.addEventListener("resize", layout, { passive: true });
    // An <img> finishing its load doesn't mutate any attribute, so the MutationObserver never
    // sees it — but it's the moment the image gets its real size and becomes badge-eligible.
    // load doesn't bubble; capture phase catches it from every image.
    window.addEventListener("load", scheduleRescan, { capture: true, passive: true });
    layoutTimer = setInterval(layout, LAYOUT_POLL_MS);
  } else {
    mutationObserver?.disconnect();
    mutationObserver = null;
    window.removeEventListener("scroll", layout, { capture: true });
    window.removeEventListener("resize", layout);
    window.removeEventListener("load", scheduleRescan, { capture: true });
    clearInterval(layoutTimer);
    clearTimeout(rescanTimer);
    tracked.clear();
    layer?.remove();
    layer = null;
    document.getElementById("provenance-badge-card")?.remove();
  }
}

function scheduleRescan() {
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(scan, RESCAN_DEBOUNCE_MS);
}

function scan() {
  if (!enabled) return;
  for (const img of document.querySelectorAll("img")) {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith("data:")) continue;
    // blob: URLs are page-scoped — the worker can't fetch them. Fail safe: no badge.
    if (src.startsWith("blob:")) continue;
    const rect = img.getBoundingClientRect();
    if (rect.width < MIN_BADGE_SIZE || rect.height < MIN_BADGE_SIZE) continue;

    const existing = tracked.get(img);
    if (existing) {
      if (existing.src !== src) untrack(img); // src swapped (carousel/lazy-load) — re-verify
      else continue;
    }
    track(img, src);
  }
  layout();
}

function track(img, src) {
  ensureLayer();
  const badge = makeBadge();
  setBadgeState(badge, "checking");
  layer.append(badge);
  const entry = { badge, src, verdict: null };
  tracked.set(img, entry);

  chrome.runtime
    .sendMessage({ type: "provenance:verdict", src })
    .then((verdict) => {
      if (!tracked.has(img) || tracked.get(img) !== entry) return;
      if (!verdict || verdict.state !== "result") {
        // error path — remove the badge entirely rather than showing anything misleading
        console.warn("[Provenance] no verdict for", src.slice(0, 90), verdict?.message || "");
        untrack(img);
        tracked.set(img, { badge: null, src, verdict: null }); // remember: don't retry every rescan
        return;
      }
      entry.verdict = verdict;
      setBadgeState(badge, verdict.tier, verdict);
      layout();
    })
    .catch((err) => {
      console.warn("[Provenance] verdict request failed:", err?.message || err);
      untrack(img);
    });
}

function untrack(img) {
  tracked.get(img)?.badge?.remove();
  tracked.delete(img);
}

function layout() {
  if (!enabled) return;
  for (const [img, { badge }] of tracked) {
    if (!img.isConnected) {
      untrack(img);
      continue;
    }
    if (!badge) continue;
    const rect = img.getBoundingClientRect();
    const visible =
      rect.width >= MIN_BADGE_SIZE &&
      rect.height >= MIN_BADGE_SIZE &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight;
    badge.style.display = visible ? "inline-flex" : "none";
    if (visible) {
      // layer is position:fixed at the viewport origin, so viewport coords are layer coords
      badge.style.transform = `translate(${Math.round(rect.right - 10)}px, ${Math.round(rect.top + 10)}px) translateX(-100%)`;
    }
  }
}

function ensureLayer() {
  if (layer?.isConnected) return;
  layer = document.createElement("div");
  layer.id = "provenance-badge-layer";
  Object.assign(layer.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "0",
    height: "0",
    zIndex: "2147483646",
    pointerEvents: "none",
  });
  const style = document.createElement("style");
  style.textContent =
    "@keyframes provenance-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.45 } }";
  layer.append(style);
  document.documentElement.append(layer);
}

function makeBadge() {
  const badge = document.createElement("button");
  Object.assign(badge.style, {
    position: "absolute",
    top: "0",
    left: "0",
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    padding: "4px 9px",
    border: "none",
    borderRadius: "999px",
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    fontSize: "9px",
    fontWeight: "700",
    letterSpacing: "0.08em",
    cursor: "pointer",
    pointerEvents: "auto",
    boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
    whiteSpace: "nowrap",
  });
  const dot = document.createElement("span");
  Object.assign(dot.style, { width: "6px", height: "6px", borderRadius: "50%", flex: "none" });
  const text = document.createElement("span");
  badge.append(dot, text);
  return badge;
}

function setBadgeState(badge, tier, verdict) {
  const [dot, text] = badge.children;
  if (tier === "checking") {
    Object.assign(badge.style, { background: "rgba(24,24,27,0.78)", color: "#a1a1aa" });
    dot.style.background = "#a1a1aa";
    badge.style.animation = "provenance-pulse 1.1s ease-in-out infinite";
    text.textContent = "CHECKING";
    badge.onclick = null;
    return;
  }
  const t = TIER_STYLE[tier] || TIER_STYLE.grey;
  badge.style.animation = "";
  Object.assign(badge.style, { background: t.bg, color: t.fg });
  dot.style.background = t.dot;
  text.textContent = t.label;
  badge.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    showCard(verdict);
  };
}

/** Same card as the context-menu flow (background.js renderProvenanceOverlay), opened on badge click. */
function showCard(data) {
  const ID = "provenance-badge-card";
  document.getElementById(ID)?.remove();

  const TIERS = {
    green: { color: "#22c55e", label: "CRYPTOGRAPHICALLY VERIFIED", note: "Exact match — unmodified since capture." },
    amber: { color: "#f59e0b", label: "MATCHES A VERIFIED CAPTURE", note: "Visually the same as an attested original; the file has changed since capture." },
    grey: { color: "#71717a", label: "NO ATTESTATION FOUND", note: "No match in the registry. Not a judgment of authenticity." },
  };
  const t = TIERS[data.tier] || TIERS.grey;

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
    borderTop: `6px solid ${t.color}`,
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
  Object.assign(wordmark.style, { fontSize: "9px", letterSpacing: "0.22em", color: "#71717a", marginBottom: "10px" });

  const headline = document.createElement("div");
  headline.textContent = t.label;
  Object.assign(headline.style, { fontSize: "14px", fontWeight: "700", letterSpacing: "0.04em", color: t.color });

  const sub = document.createElement("div");
  sub.textContent = t.note;
  Object.assign(sub.style, { fontSize: "11px", color: "#a1a1aa", marginTop: "6px" });

  card.append(close, wordmark, headline, sub);

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

  document.documentElement.append(card);
}
