/**
 * Strava Segment Fetch Interceptor — MAIN world content script
 *
 * Site-specific configuration for the generic interceptor base.
 * All fetch-wrapping machinery lives in adapters/interceptor-base.js,
 * which must be loaded before this file (see manifest.json).
 *
 * This file declares:
 *  • The site identifier (SITE)
 *  • The URL rules that map Strava API response URLs to dataType keys
 *  • A title-capture hook that reads document.title once the DOM is ready
 *    and posts it as a "metadata" message so the builder can name the GPX
 *    file after the segment
 *
 * Intercepted endpoints
 * ─────────────────────
 *  stream   /stream/segments/<id>  — latlng, altitude, distance arrays
 *  metadata  document.title        — human-readable segment name
 *                                    (stripped of " | Strava …" suffix)
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
  const SITE = "strava";

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
  // The extension cannot know the segment ID at intercept-install time, so we
  // match any /stream/segments/ URL and let the builder validate the shape.
  // ---------------------------------------------------------------------------
  window.__routeExtractorBase({
    site: SITE,
    msgNamespace: MSG_NAMESPACE,
    rules: [
      {
        // Stream endpoint — carries latlng, altitude, and distance arrays.
        // URL form: /stream/segments/<id>?streams[]=latlng&streams[]=altitude&…
        predicate: (url) => url.includes("/stream/segments/"),
        dataType: "stream",
      },
    ],
  });

  // ---------------------------------------------------------------------------
  // Title capture via document.title
  //
  // Strava segment page titles follow the pattern:
  //   "Segment Name | Strava Ride Segment in City, Country"
  //
  // Strip the " | Strava …" suffix and post it as a synthetic "metadata"
  // payload so the builder can name the file without intercepting an extra API.
  //
  // The hook fires at DOMContentLoaded (or immediately if the DOM is already
  // ready) and, as a safety net, again on the window load event in case Strava
  // updates the title asynchronously after the initial parse.
  // ---------------------------------------------------------------------------
  function postTitleMetadata() {
    const raw = document.title;
    if (!raw) return;

    // Strip the " | Strava …" suffix — keep only the segment name part.
    const title = raw.split("|")[0].trim();
    if (!title) return;

    window.postMessage(
      {
        [MSG_NAMESPACE]: true,
        site: SITE,
        dataType: "metadata",
        data: { title },
        url: location.href,
      },
      // Restrict to the current origin so other frames cannot snoop.
      window.location.origin,
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", postTitleMetadata);
  } else {
    // Document was already parsed — fire synchronously.
    postTitleMetadata();
  }

  // Second attempt: Strava may update document.title after initial paint via
  // JavaScript. Firing on load gives the SPA time to settle.
  window.addEventListener("load", postTitleMetadata, { once: true });
})();
