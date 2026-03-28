/**
 * Background Service Worker — Route to GPX
 *
 * Generic orchestrator — contains no site-specific logic.
 *
 * Data flow:
 *  1. A MAIN-world interceptor (adapters/<site>/interceptor.js) wraps
 *     window.fetch and posts captured API responses to the isolated-world
 *     bridge (content/index.js) via window.postMessage.
 *  2. The bridge forwards the payload here via "storeRouteData", tagged with
 *     a `site` identifier so the correct adapter can be dispatched later.
 *  3. Data is persisted in chrome.storage.session so it survives the service
 *     worker being killed between capture and download (MV3 workers are
 *     terminated after ~30 s of inactivity).
 *  4. On "downloadGPX" the background reads the stored data, delegates
 *     title/segment extraction to the matching adapter, builds a GPX document
 *     via the shared gpx.js builder, and triggers a chrome.downloads call.
 */

import { buildGpxDocument } from "./gpx.js";
import { assertAdapterContract } from "../adapters/adapter-interface.js";
import * as bikemapAdapter from "../adapters/bikemap/builder.js";

// ---------------------------------------------------------------------------
// Adapter registry
//
// Keys must match the `site` string posted by each adapter's interceptor.js
// and the `id` field in each site's popup/sites.js entry.
// ---------------------------------------------------------------------------

const ADAPTERS = {
  bikemap: assertAdapterContract("bikemap", bikemapAdapter),
};

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case "storeRouteData":
      // Only ever sent by a content script, so sender.tab.id is always present.
      storeRouteDataForTab(
        sender.tab.id,
        request.site,
        request.dataType,
        request.data,
      )
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // async

    case "clearRouteData":
      // Only ever sent by a content script, so sender.tab.id is always present.
      clearRouteDataForTab(sender.tab.id)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // async

    case "getRouteStatus": {
      // Called by the popup, which passes tabId and routeId explicitly because
      // popup messages have no sender.tab.
      getRouteDataForTab(request.tabId)
        .then((data) => {
          const adapter = data?.site ? ADAPTERS[data.site] : null;
          sendResponse({
            hasData: adapter ? adapter.hasData(data) : false,
            title: adapter
              ? adapter.extractTitle(data, request.routeId ?? null)
              : null,
          });
        })
        .catch(() => sendResponse({ hasData: false, title: null }));
      return true; // async
    }

    case "downloadGPX": {
      // Content scripts have sender.tab.id; the popup passes tabId explicitly.
      const tabId = sender.tab?.id ?? request.tabId;
      handleDownloadGPX(tabId, request.routeId)
        .then((result) => sendResponse({ success: true, ...result }))
        .catch((error) =>
          sendResponse({ success: false, error: error.message }),
        );
      return true; // async
    }
  }
});

// Remove session data when the tab is closed so we don't accumulate stale
// entries for tabs that will never send another message.
chrome.tabs.onRemoved.addListener((tabId) => {
  clearRouteDataForTab(tabId).catch(() => {});
  _storeLocks.delete(tabId); // clean up the per-tab serialisation chain
});

// ---------------------------------------------------------------------------
// Session storage helpers
//
// Each tab's route data is stored under the key "route_<tabId>" as an object
// with a `site` field (so the correct adapter can be dispatched on download)
// plus any dataType fields populated by the interceptor (e.g. "geometry",
// "route").  The object is built up incrementally as the SPA makes its API
// calls, so individual fields may be absent until the page finishes loading.
// ---------------------------------------------------------------------------

function sessionKey(tabId) {
  return `route_${tabId}`;
}

// Serialises concurrent writes for the same tab so a rapid burst of API
// responses (e.g. geometry + route arriving nearly simultaneously) never
// causes a read-modify-write race in chrome.storage.session.
/** @type {Map<number, Promise<void>>} */
const _storeLocks = new Map();

async function storeRouteDataForTab(tabId, site, dataType, data) {
  // Validate with the adapter before writing to storage so the background
  // never holds structurally invalid data that would cause a confusing error
  // at download time.
  const adapter = site ? ADAPTERS[site] : null;
  if (adapter?.validate) {
    const validationError = adapter.validate(dataType, data);
    if (validationError) {
      throw new Error(
        `[${site}] Validation failed for ${dataType}: ${validationError}`,
      );
    }
  }

  // Chain this write onto the tail of any in-progress write for the same tab
  // so concurrent calls are serialised rather than interleaved.
  const prev = _storeLocks.get(tabId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const key = sessionKey(tabId);
    const existing = (await getRouteDataForTab(tabId)) ?? {};
    existing.site = site;
    existing[dataType] = data;
    await chrome.storage.session.set({ [key]: existing });
    console.log(
      `[Background] Stored ${dataType} data for tab ${tabId} (site: ${site})`,
    );
  });

  // Keep the chain alive but swallow errors so a failed write doesn't
  // permanently block future writes for this tab.
  _storeLocks.set(
    tabId,
    next.catch(() => {}),
  );

  return next; // re-throws to the caller if the storage operation fails
}

async function getRouteDataForTab(tabId) {
  const key = sessionKey(tabId);
  const result = await chrome.storage.session.get(key);
  return result[key] ?? null;
}

async function clearRouteDataForTab(tabId) {
  await chrome.storage.session.remove(sessionKey(tabId));
  console.log(`[Background] Cleared route data for tab ${tabId}`);
}

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

/**
 * Strips characters that are illegal in filenames on Windows, macOS, and Linux,
 * then collapses whitespace and guards against leading-dot hidden-file names.
 */
function sanitizeFilename(name) {
  return (
    name
      .replace(/[/\\:*?"<>|]/g, "_") // characters illegal on Windows / macOS / Linux
      .replace(/\s+/g, " ") // collapse whitespace runs
      .trim()
      .replace(/^\.+/, "_") || // prevent hidden-file names (leading dots)
    "route" // ultimate fallback if everything was stripped
  );
}

/**
 * Encodes a UTF-8 string as a base64 data URL suitable for chrome.downloads.
 *
 * Uses TextEncoder instead of the deprecated unescape() + btoa() idiom.
 * Array.from is used instead of spread (...bytes) to avoid a stack overflow
 * on very large routes where spreading a large TypedArray can hit engine limits.
 */
function gpxToDataUrl(content) {
  const bytes = new TextEncoder().encode(content);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return `data:application/gpx+xml;base64,${btoa(binary)}`;
}

// ---------------------------------------------------------------------------
// Download orchestrator
// ---------------------------------------------------------------------------

async function handleDownloadGPX(tabId, routeId) {
  const stored = await getRouteDataForTab(tabId);
  const adapter = stored?.site ? ADAPTERS[stored.site] : null;

  if (!adapter) {
    throw new Error(
      stored?.site
        ? `No adapter registered for site "${stored.site}".`
        : "No route data found for this tab. Please reload the page and try again.",
    );
  }

  // Delegates all site-specific logic to the adapter — the orchestrator
  // itself stays completely site-agnostic.
  const title = adapter.extractTitle(stored, routeId);
  const segments = adapter.extractSegments(stored); // throws if not ready

  const gpxContent = buildGpxDocument(title, segments);
  const filename = `${sanitizeFilename(title)}.gpx`;
  const url = gpxToDataUrl(gpxContent);

  await chrome.downloads.download({ url, filename, saveAs: false });

  console.log(`[Background] Downloaded ${filename}`);
  return { filename };
}

console.log("[Background] Service worker loaded");
