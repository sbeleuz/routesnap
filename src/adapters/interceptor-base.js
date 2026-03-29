/**
 * Generic Network Interceptor Base — MAIN world content script
 *
 * Provides the shared fetch- and XMLHttpRequest-wrapping machinery used by
 * every site adapter. Exposes window.__routeExtractorBase(config) so each
 * site's interceptor declares only its URL rules instead of reimplementing
 * the full pipeline.
 *
 * Must be listed before any site-specific interceptor in each
 * content_scripts entry in manifest.json.
 *
 * ─── Data flow ───────────────────────────────────────────────────────────
 *  1. Both window.fetch and window.XMLHttpRequest are wrapped once per site
 *     (guarded against re-installation).
 *  2. Every successful response URL is tested against the caller's `rules`
 *     array in order; the first matching rule wins.
 *  3. Only if a rule matches is the response body parsed as JSON and posted
 *     to the isolated-world bridge (content/index.js) via window.postMessage.
 *     Responses whose URLs match no rule are left completely untouched —
 *     no body read, no JSON parse attempt, no console output.
 *
 *  Both transports are intercepted because different sites (and even
 *  different endpoints on the same site) use different HTTP mechanisms.
 *  For example, Bikemap uses fetch while Strava's legacy segment pages use
 *  XMLHttpRequest via jQuery. Intercepting both here means each site adapter
 *  only has to declare its URL rules once and they work regardless of which
 *  transport the page happens to use.
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
   * Installs fetch and XMLHttpRequest wrappers for the given site configuration.
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

    // -------------------------------------------------------------------------
    // Shared helper — find the first rule whose predicate matches `url`.
    //
    // Returns the matched rule object ({ predicate, dataType }) or null.
    // JSON parsing is only attempted after a match is confirmed, so responses
    // that belong to no rule (images, fonts, tile PNGs, …) are never touched.
    // -------------------------------------------------------------------------

    function matchRule(url) {
      for (const rule of rules) {
        if (rule.predicate(url)) return rule;
      }
      return null;
    }

    // -------------------------------------------------------------------------
    // Shared helper — post an already-parsed payload to the isolated-world
    // bridge (content/index.js) via window.postMessage.
    // -------------------------------------------------------------------------

    function postCapture(rule, url, data, transport) {
      window.postMessage(
        {
          [msgNamespace]: true,
          site: site,
          dataType: rule.dataType,
          data: data,
          url: url,
        },
        // Restrict to the current origin so other frames cannot snoop
        // on captured route data.
        window.location.origin,
      );
      console.log(
        `[routesnap:${site}] Captured ${rule.dataType} via ${transport} from ${url}`,
      );
    }

    // -------------------------------------------------------------------------
    // 1. Fetch wrapper
    // -------------------------------------------------------------------------

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

      // Check URL rules before touching the body. Responses that match no
      // rule are returned immediately — no clone, no JSON parse, no logging.
      const rule = matchRule(url);
      if (!rule) return response;

      // Clone before reading so the SPA can still consume the original body.
      // The clone and the original share the underlying stream implementation;
      // reading one does not disturb the other.
      response
        .clone()
        .json()
        .then(function (data) {
          postCapture(rule, url, data, "fetch");
        })
        .catch(function (err) {
          // Structural JSON failure on a URL we expected to be JSON — worth
          // logging since it likely indicates a Strava/Bikemap API change.
          console.warn(
            `[routesnap:${site}] Could not parse fetch response from`,
            url,
            err,
          );
        });

      return response;
    };

    // -------------------------------------------------------------------------
    // 2. XMLHttpRequest wrapper
    //
    // Strava's legacy segment pages (and many other Rails/jQuery apps) use XHR
    // rather than fetch. We patch the constructor so every `new XMLHttpRequest()`
    // call returns a real XHR instance with `open` and `send` shimmed.
    //
    // The real XHR instance is returned from the constructor — not `this` — so
    // all native properties (status, responseText, onload, …) work normally.
    // The prototype chain is preserved so `instanceof XMLHttpRequest` remains
    // true for the returned instance.
    // -------------------------------------------------------------------------

    const _OriginalXHR = window.XMLHttpRequest;

    window.XMLHttpRequest = function PatchedXHR() {
      // Create a genuine XHR so all native behaviour is preserved.
      const xhr = new _OriginalXHR();

      // Capture open/send from the instance rather than the prototype so this
      // works whether the methods are defined on the prototype (real browsers)
      // or as own properties on the instance (some polyfills / shim envs).
      const _instanceOpen = xhr.open;
      const _instanceSend = xhr.send;

      // Capture the requested URL when open() is called.
      let capturedUrl = "";

      xhr.open = function (method, url /*, async, user, password */) {
        capturedUrl = url;
        return _instanceOpen.apply(xhr, arguments);
      };

      xhr.send = function () {
        xhr.addEventListener("load", function () {
          // Skip error / redirect responses.
          if (xhr.status < 200 || xhr.status >= 300) return;

          // Resolve a potentially-relative URL to absolute so predicates can
          // use simple string matching without worrying about relative paths.
          let fullUrl;
          try {
            fullUrl = new URL(capturedUrl, location.href).href;
          } catch (_) {
            // Unparseable URL — silently skip.
            return;
          }

          // Check URL rules before touching the body. XHR responses that
          // match no rule (images, tile data, …) are skipped entirely —
          // no JSON.parse, no console output.
          const rule = matchRule(fullUrl);
          if (!rule) return;

          try {
            const data = JSON.parse(xhr.responseText);
            postCapture(rule, fullUrl, data, "xhr");
          } catch (err) {
            // Structural JSON failure on a URL we expected to be JSON.
            console.warn(
              `[routesnap:${site}] Could not parse XHR response from`,
              fullUrl,
              err,
            );
          }
        });

        return _instanceSend.apply(xhr, arguments);
      };

      // Return the real (patched) XHR instance. JavaScript's `new` operator
      // uses this object as the result when a constructor explicitly returns
      // an object, so callers receive a genuine XMLHttpRequest with our shims.
      return xhr;
    };

    // Preserve the prototype so `instanceof XMLHttpRequest` keeps working.
    window.XMLHttpRequest.prototype = _OriginalXHR.prototype;

    console.log(
      `[routesnap:${site}] Fetch + XHR interceptors installed in MAIN world`,
    );
  }

  window.__routeExtractorBase = createInterceptor;
})();
