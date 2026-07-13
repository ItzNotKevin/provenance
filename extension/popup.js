/**
 * Popup — drives the per-tab badge scanner (badges.js). MV3 CSP forbids inline scripts, hence
 * this file. The scanner is opt-in per tab (except on the demo feed, where it auto-enables), so
 * the popup's job is just: show current state, toggle on click.
 */

const button = document.getElementById("scan");
const hint = document.getElementById("scan-hint");

function render(state) {
  if (!state) {
    button.disabled = true;
    button.textContent = "SCAN THIS PAGE";
    hint.textContent = "Can't scan this page (reload the tab, or it's a chrome:// page).";
    return;
  }
  button.disabled = false;
  button.classList.toggle("on", state.enabled);
  button.textContent = state.enabled ? "STOP SCANNING" : "SCAN THIS PAGE";
  hint.textContent = state.enabled
    ? `Scanning — ${state.count} image${state.count === 1 ? "" : "s"} badged.`
    : "Badges every photo in the feed.";
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function send(type) {
  const tabId = await activeTabId();
  if (tabId == null) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, { type });
  } catch {
    return null; // content script not loaded (chrome:// page, or tab predates the extension)
  }
}

button.addEventListener("click", async () => {
  render(await send("provenance:badgesToggle"));
});

send("provenance:badgesStatus").then(render);
