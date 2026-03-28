/**
 * Generic Fetch Interceptor Base — MAIN world content script
 *
 * Provides the shared fetch-wrapping machinery used by every site adapter.
 * Exposes window.__routeExtractorBase(config) so each site's interceptor
 * declares only its URL rules instead of reimplementing the full pipeline.
 *
 * Must be listed before any site-specific interceptor in each
 * content_scripts entry in manifest.json.
 *
 * ─── Data flow ───────────────────────────────────────────────────────────
 *  1. window.fetch is wrapped once per site (guarded against re-installation).
 *  2. Every successful response URL is tested against the caller's `rules`
 *     array in order; the first matching rule wins.
 *  3. The response body is cloned and parsed as JSON (so the page still gets
 *     the original response), then posted to the isolated-world bridge
 *     (content/index.js) via window.postMessage.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Config shape:
 *
 *  {
 *    site:         string
 *                  Unique site identifier. Must match:
 *                    • The key in the ADAPTERS map in background/index.js
 *                    • The `id` field in this site's popup/sites.js entry
 *                    • The SITE constant in this site's interceptor.js
 *
 *    msgNamespace: string
 *                  Namespace token used as the postMessage envelope key.
 *                  Must match MSG_NAMESPACE in content/index.js.
 *
 *    rules:        Array<{ predicate: (url: string) => boolean, dataType: string }>
 *                  Ordered list of URL rules. Each rule maps a URL predicate
 *                  to the dataType string written to session storage and
 *                  passed to the adapter's validate() / extractSegments().
 *                  Rules are evaluated in order; a URL matches at most one.
 *  }
 */

(function () {
  "use strict";

  /**
   * Installs a fetch wrapper for the given site configuration.
   *
   * Safe to call multiple times for different sites on the same page — each
   * call is guarded by a per-site flag so re-installation (e.g. bfcache
   * restore, duplicate script injection) is always a no-op.
   *
   * @param {{
   *   site:         string,
   *   msgNamespace: string,
   *   rules:        Array<{ predicate: (url: string) => boolean, dataType: string }>
   * }} config
   */
  function createInterceptor(config) {
    const site = config.site;
    const msgNamespace = config.msgNamespace;
    const rules = config.rules;

    // Guard against double-installation (e.g. bfcache restore).
    const guardKey = "__routeExtractorInstalled_" + site;
    if (window[guardKey]) return;
    window[guardKey] = true;

    const _originalFetch = window.fetch.bind(window);

    window.fetch = async function (input, init) {
      // Always execute the real request first — we must never break the page.
      const response = await _originalFetch(input, init);

      // Use response.url (the final URL after any redirects) rather than
      // resolving the input ourselves. The input can be a string, a URL
      // object, or a Request object; response.url is always a plain string.
      const url = response.url;

      // Skip non-OK responses — storing a 401 / 403 / 500 body as route data
      // would cause a confusing failure later when the GPX is built.
      if (!response.ok) return response;

      // Test each rule in declaration order; stop at the first match so a
      // URL is never posted twice with two different dataType labels.
      for (const rule of rules) {
        if (rule.predicate(url)) {
          const dataType = rule.dataType;

          // Clone before reading so the SPA can still consume the original
          // body. The clone and the original share the underlying stream
          // implementation; reading one does not disturb the other.
          response
            .clone()
            .json()
            .then(function (data) {
              window.postMessage(
                {
                  [msgNamespace]: true,
                  site: site,
                  dataType: dataType,
                  data: data,
                  url: url,
                },
                // Restrict to the current origin so other frames cannot snoop
                // on captured route data.
                window.location.origin,
              );
            })
            .catch(function (err) {
              // Non-JSON body or network failure — silently ignore so the page
              // is never broken by our instrumentation.
              console.warn(
                "[routesnap:" + site + "] Could not parse response from",
                url,
                err,
              );
            });

          // A URL matches at most one rule.
          break;
        }
      }

      return response;
    };

    console.log(
      "[routesnap:" + site + "] Fetch interceptor installed in MAIN world",
    );
  }

  window.__routeExtractorBase = createInterceptor;
})();
