/**
 * Content Script — Route to GPX (isolated world)
 *
 * Generic data bridge — contains no site-specific logic.
 *
 * Responsibilities:
 *  1. Receive captured API data from any MAIN-world interceptor
 *     (adapters/<site>/interceptor.js) via window.postMessage
 *  2. Forward that data — including the `site` identifier — to the background
 *     worker immediately on capture; the background is the single source of truth
 *  3. Detect SPA navigation and tell the background to clear stale data
 *
 * This file must never contain site-specific logic (URL patterns, field names,
 * data shape checks). All such knowledge belongs in adapters/<site>/builder.js.
 */

// ---------------------------------------------------------------------------
// Namespace token
//
// Must match the key used in window.postMessage calls by every MAIN-world
// interceptor (adapters/<site>/interceptor.js).
// ---------------------------------------------------------------------------
const MSG_NAMESPACE = "__routeExtractor";

// ---------------------------------------------------------------------------
// 1. Bridge MAIN world → background
//
// The content script holds no route data of its own — it is a thin relay.
// Large coordinate payloads are serialised only once (here), not again on
// every popup interaction.
// ---------------------------------------------------------------------------
window.addEventListener("message", function (event) {
  // Only accept messages originating from the same page window.
  if (event.source !== window) return;

  const msg = event.data;
  if (!msg || msg[MSG_NAMESPACE] !== true) return;

  // Validate the message envelope — site-agnostic structural check only.
  // Data-shape validation is the adapter's responsibility (builder.js#validate),
  // and is performed inside the background before writing to storage.
  if (
    typeof msg.site !== "string" ||
    typeof msg.dataType !== "string" ||
    msg.data == null
  ) {
    console.warn("[Content] Received malformed route extractor message", msg);
    return;
  }

  // Forward to background — fire-and-forget, errors are non-fatal here.
  chrome.runtime
    .sendMessage({
      action: "storeRouteData",
      site: msg.site,
      dataType: msg.dataType,
      data: msg.data,
    })
    .catch((err) => {
      console.warn(
        "[Content] Could not forward",
        msg.site,
        msg.dataType,
        "data to background:",
        err,
      );
    });

  console.log(
    "[Content] Forwarded",
    msg.site,
    msg.dataType,
    "data to background from",
    msg.url,
  );
});

// ---------------------------------------------------------------------------
// 2. SPA navigation handling
//
// Many supported sites are SPAs — the user can navigate from one route to
// another without a full page reload. When that happens we must tell the
// background to clear its stored data for this tab so stale data from the
// previous route is never downloaded for the new one. Each interceptor will
// re-capture fresh data naturally as the SPA makes its API calls.
//
// Navigation is detected by watching for any URL change via a MutationObserver
// (fires on DOM mutations that typically accompany a route change) combined
// with popstate for history-API back/forward navigation.
// ---------------------------------------------------------------------------
let lastHref = location.href;

function handleNavigation() {
  if (location.href === lastHref) return;
  lastHref = location.href;

  console.log("[Content] Navigation detected, clearing background route data");

  chrome.runtime.sendMessage({ action: "clearRouteData" }).catch(() => {
    // Background may not be running yet — non-fatal.
  });
}

new MutationObserver(handleNavigation).observe(document, {
  subtree: true,
  childList: true,
});

window.addEventListener("popstate", handleNavigation);

console.log("[Content] Script initialised");
