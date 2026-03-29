/**
 * Popup Script — Route to GPX
 *
 * Generic download UI. No site-specific logic lives here — all site
 * knowledge comes from the SITES registry in sites.js.
 *
 * Responsibilities:
 *  1. Detect whether the active tab is a supported route page by testing
 *     its URL against each entry in SITES
 *  2. Poll the background for captured route data (handles the case where
 *     the popup is opened while the page is still loading)
 *  3. Trigger the download via the background, passing tabId explicitly
 *     (popup messages carry no sender.tab, unlike content-script messages)
 */

import { SITES } from "./sites.js";

const POLL_INTERVAL_MS = 1000;
const POLL_MAX_ATTEMPTS = 5; // 5 seconds total

// ---------------------------------------------------------------------------
// DOM refs — resolved once after DOMContentLoaded
// ---------------------------------------------------------------------------
let elements = {};

function resolveElements() {
  elements = {
    stateNotRoute: document.getElementById("state-not-route"),
    stateRoute: document.getElementById("state-route"),
    siteHints: document.getElementById("site-hints"),
    routeTitle: document.getElementById("route-title"),
    routeId: document.getElementById("route-id"),
    dataStatus: document.getElementById("data-status"),
    dataStatusText: document.getElementById("data-status-text"),
    downloadBtn: document.getElementById("download-btn"),
    downloadResult: document.getElementById("download-result"),
    refreshBtn: document.getElementById("refresh-btn"),
  };
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function showState(name) {
  elements.stateNotRoute.hidden = name !== "not-route";
  elements.stateRoute.hidden = name !== "route";
}

function setDataStatus(ready) {
  elements.dataStatus.className =
    "data-status " + (ready ? "ready" : "loading");
  elements.dataStatusText.textContent = ready
    ? "✅ Route data captured"
    : "⏳ Waiting for route data…";
  elements.downloadBtn.disabled = !ready;
}

function setRouteInfo(routeId, title) {
  elements.routeId.textContent = routeId;
  elements.routeTitle.textContent = title || routeId;
}

function setDownloadResult(state, text) {
  elements.downloadResult.hidden = state === "hidden";
  elements.downloadResult.className = "download-result " + state;
  elements.downloadResult.textContent = text;
}

/**
 * Populates the "not a route page" state with one hint block per registered
 * site so the user knows which URLs the extension supports.
 */
function populateSiteHints() {
  elements.siteHints.innerHTML = "";

  SITES.forEach((site) => {
    const hintUrl = document.createElement("p");
    hintUrl.className = "hint-url";
    hintUrl.textContent = site.hintUrl;
    elements.siteHints.appendChild(hintUrl);
  });
}

// ---------------------------------------------------------------------------
// Background communication
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls the background until route data is ready or we give up.
 * Returns the final status object { hasData, title }.
 */
async function pollForRouteStatus(tabId, routeId) {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const status = await chrome.runtime.sendMessage({
      action: "getRouteStatus",
      tabId,
      routeId,
    });

    if (status.hasData) return status;

    // Update the seconds-remaining counter so the user can see progress.
    const remaining = POLL_MAX_ATTEMPTS - attempt - 1;
    if (remaining > 0) {
      elements.dataStatusText.textContent = `⏳ Waiting for route data… (${remaining}s)`;
      await sleep(POLL_INTERVAL_MS);
    }
  }

  return { hasData: false, title: null };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  resolveElements();

  // Populate the version badge from the manifest so it never drifts out of sync.
  const versionEl = document.querySelector(".version");
  if (versionEl) {
    versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Find the first site whose routePattern matches the current tab URL.
  const site = SITES.find((s) => s.routePattern.test(tab?.url ?? ""));

  if (!site) {
    populateSiteHints();
    showState("not-route");
    return;
  }

  const routeId = site.extractRouteId(tab.url);
  showState("route");
  setRouteInfo(routeId, null);
  setDataStatus(false);

  // ---------------------------------------------------------------------------
  // Refresh button — wired up before polling so it works while waiting.
  // ---------------------------------------------------------------------------
  elements.refreshBtn.addEventListener("click", () => {
    chrome.tabs.reload(tab.id);
    window.close();
  });

  // ---------------------------------------------------------------------------
  // Download button
  // ---------------------------------------------------------------------------
  elements.downloadBtn.addEventListener("click", async () => {
    elements.downloadBtn.disabled = true;
    elements.downloadBtn.textContent = "Downloading…";
    setDownloadResult("hidden", "");

    try {
      const result = await chrome.runtime.sendMessage({
        action: "downloadGPX",
        routeId,
        tabId: tab.id,
      });

      if (result?.success) {
        elements.downloadBtn.textContent = "⬇ Download GPX";
        elements.downloadBtn.disabled = false;
        setDownloadResult("success", `✅ Saved: ${result.filename}`);
      } else {
        throw new Error(
          result?.error || "Unknown error from background worker",
        );
      }
    } catch (err) {
      elements.downloadBtn.textContent = "⬇ Download GPX";
      elements.downloadBtn.disabled = false;
      setDownloadResult("error", `❌ ${err.message}`);
    }
  });

  // Poll until data is captured or we time out.
  const status = await pollForRouteStatus(tab.id, routeId);

  setDataStatus(status.hasData);

  if (status.hasData) {
    setRouteInfo(routeId, status.title);
  } else {
    elements.dataStatusText.textContent =
      "❌ Route data not captured — try reloading the page.";
  }
});
