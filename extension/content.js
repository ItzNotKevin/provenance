/**
 * Content script — recovers the image the user meant when the plain "image" context menu can't
 * fire. Instagram carousels lay a transparent swipe overlay *and* set `pointer-events: none` on
 * the slide <img>, so a right-click lands on a wrapper and Chrome reports no srcUrl — and even
 * elementsFromPoint (which respects pointer-events) won't return the image. This records where
 * the last right-click happened and, on request, finds the real image through several fallbacks
 * ending in "largest image visible in the viewport" (the main photo on a post page).
 */

let lastContextClick = { x: 0, y: 0 };

// Capture phase so we still see the event even if the page stops propagation on its overlay.
window.addEventListener(
  "contextmenu",
  (e) => {
    lastContextClick = { x: e.clientX, y: e.clientY };
  },
  true
);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "provenance:findImage") return;
  const result = findImage();
  result.imgCount = document.querySelectorAll("img").length;
  result.click = { x: lastContextClick.x, y: lastContextClick.y };
  console.log(
    "[Provenance] findImage @",
    result.click.x,
    result.click.y,
    "->",
    result.src ? result.src.slice(0, 90) : "NONE",
    "| <img> on page:",
    result.imgCount,
    "| via:",
    result.via || "-"
  );
  sendResponse(result);
  return false; // response is synchronous
});

function imgResult(img, via) {
  return {
    src: img.currentSrc || img.src,
    width: img.naturalWidth || 0,
    height: img.naturalHeight || 0,
    via,
  };
}

function findImage() {
  const { x, y } = lastContextClick;
  const stack = document.elementsFromPoint(x, y) || [];

  // 1) A real <img> in the hit-test stack under the cursor.
  for (const el of stack) {
    if (el.tagName === "IMG" && (el.currentSrc || el.src)) return imgResult(el, "point-img");
  }

  // 2) A CSS background-image on any element under the cursor.
  for (const el of stack) {
    const bg = getComputedStyle(el).backgroundImage;
    const match = bg && bg.match(/url\(["']?(.*?)["']?\)/);
    if (match && match[1] && !match[1].startsWith("data:image/svg")) {
      return { src: match[1], width: 0, height: 0, via: "point-bg" };
    }
  }

  const all = Array.from(document.querySelectorAll("img"))
    .map((img) => ({ img, r: img.getBoundingClientRect() }))
    .filter(({ img, r }) => r.width > 32 && r.height > 32 && (img.currentSrc || img.src));

  // 3) Largest <img> whose bounding box contains the click point (ignores pointer-events).
  const containing = all
    .filter(({ r }) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
    .sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height);
  if (containing.length) return imgResult(containing[containing.length - 1].img, "box-contains");

  // 4) Last resort: the largest image actually visible in the viewport (the main post photo).
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const visible = all
    .map(({ img, r }) => {
      const iw = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const ih = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      return { img, area: iw * ih };
    })
    .filter((v) => v.area > 4096)
    .sort((a, b) => a.area - b.area);
  if (visible.length) return imgResult(visible[visible.length - 1].img, "viewport-largest");

  return { src: null, via: "none" };
}
