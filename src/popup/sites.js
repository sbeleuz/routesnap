/**
 * Popup Site Registry — ES module
 *
 * The single place to register popup-side metadata for every supported site.
 *
 * The popup imports this array to:
 *  1. Detect whether the active tab is a supported route page
 *     (tested against `routePattern`)
 *  2. Extract a human-readable route ID from the tab URL
 *     (used as a display label and download filename fallback)
 *  3. Show per-site hint URLs when the tab is NOT on any supported page
 *
 * Shape of each entry:
 *
 *  id             {string}   Unique site identifier. Must match the `site`
 *                            field posted by the MAIN-world interceptor.
 *
 *  routePattern   {RegExp}   Tested against tab.url to decide whether the
 *                            popup is on a supported route page.
 *
 *  extractRouteId {Function} (url: string) => string
 *                            Extracts a route ID string from the tab URL.
 *                            Used as a display label and filename fallback.
 *
 *  hintText       {string}   Short instruction shown in the "not a route
 *                            page" state, e.g. "Open a Bikemap route page…"
 *
 *  hintUrl        {string}   Example URL pattern shown below the hint text,
 *                            e.g. "web.bikemap.net/r/…"
 */

export const SITES = [
  {
    id: "bikemap",
    routePattern: /web\.bikemap\.net\/r\/\d+/,
    extractRouteId: (url) => url.match(/\/r\/(\d+)/)?.[1] ?? "",
    hintText: "Open a Bikemap route page to download a GPX file.",
    hintUrl: "web.bikemap.net/r/…",
  },
];
