/**
 * Bikemap Fetch Interceptor — MAIN world content script
 *
 * Site-specific configuration for the generic interceptor base.
 * All fetch-wrapping machinery lives in adapters/interceptor-base.js,
 * which must be loaded before this file (see manifest.json).
 *
 * This file only declares:
 *  • The site identifier (SITE)
 *  • The URL rules that map Bikemap API response URLs to dataType keys
 */

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Adapter identity
  //
  // SITE must match:
  //  • The key used in the ADAPTERS registry in background/index.js
  //  • The `id` field of this site's entry in popup/sites.js
  // ---------------------------------------------------------------------------
  const SITE = "bikemap";

  // Namespace token that the isolated-world bridge (content/index.js) uses to
  // recognise messages originating from a route-extractor interceptor.
  const MSG_NAMESPACE = "__routeExtractor";

  // ---------------------------------------------------------------------------
  // URL rules
  //
  // Each rule maps a URL predicate to the dataType key used for session storage
  // and passed to the builder's validate() / extractSegments() functions.
  //
  // Rules are evaluated in order; a URL matches at most one rule.
  //
  // Both tools target the same two API responses as scripts/bikemap_to_gpx.py.
  // The matching logic differs by design: the Python script filters by a known
  // route_id, while the extension intercepts any route (the ID isn't known at
  // intercept time). Both exclude the same sub-resource paths.
  // ---------------------------------------------------------------------------
  window.__routeExtractorBase({
    site: SITE,
    msgNamespace: MSG_NAMESPACE,
    rules: [
      {
        // Geometry endpoint — always contains "geometry/extended" in the path.
        predicate: (url) => url.includes("geometry/extended"),
        dataType: "geometry",
      },
      {
        // Route metadata endpoint — matches /api/v6/routes/<id> but excludes
        // all sub-resource URLs that also contain "/routes/" in their path.
        predicate: (url) =>
          url.includes("/api/v6/routes/") &&
          !url.includes("geometry") &&
          !url.includes("pois") &&
          !url.includes("metadata") &&
          !url.includes("collections") &&
          !url.includes("accommodations") &&
          !url.includes("top-tour") &&
          !url.includes("matched"),
        dataType: "route",
      },
    ],
  });
})();
