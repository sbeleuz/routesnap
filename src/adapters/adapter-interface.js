/**
 * AdapterBuilder Interface — ES module, background service worker
 *
 * Defines the contract every site adapter must satisfy.
 *
 * ─── For adapter authors ──────────────────────────────────────────────────
 * Add `@implements {AdapterBuilder}` to your builder module's file-level
 * JSDoc comment and annotate each export with the matching @callback type:
 *
 *   /** @type {import('../adapter-interface.js').ValidateFn} *\/
 *   export function validate(dataType, data) { … }
 *
 *   /** @type {import('../adapter-interface.js').HasDataFn} *\/
 *   export function hasData(stored) { … }
 *
 *   /** @type {import('../adapter-interface.js').ExtractTitleFn} *\/
 *   export function extractTitle(stored, routeId) { … }
 *
 *   /** @type {import('../adapter-interface.js').ExtractSegmentsFn} *\/
 *   export function extractSegments(stored) { … }
 *
 * ─── For the adapter registry ─────────────────────────────────────────────
 * Wrap every entry in the ADAPTERS map with assertAdapterContract() so that
 * a missing or misnamed export is caught at service-worker startup rather
 * than surfacing as a cryptic TypeError deep inside the download flow:
 *
 *   import { assertAdapterContract } from "../adapters/adapter-interface.js";
 *
 *   const ADAPTERS = {
 *     mysite: assertAdapterContract("mysite", mysiteAdapter),
 *   };
 * ──────────────────────────────────────────────────────────────────────────
 */

// ---------------------------------------------------------------------------
// Function-signature definitions (@callback)
//
// Each callback documents one method of the AdapterBuilder interface.
// Keeping them as separate @callback types lets adapter modules reference
// individual signatures with a plain @type tag, which gives precise
// hover-documentation in editors without requiring TypeScript.
// ---------------------------------------------------------------------------

/**
 * Validates a single captured payload before it is written to session storage.
 *
 * Called by the background for every "storeRouteData" message so that
 * structurally invalid data is rejected at the earliest possible point —
 * before it can cause a confusing error during GPX construction.
 *
 * Implementations should perform structural checks only (field presence,
 * type checks, non-empty arrays). Deep semantic validation belongs in
 * extractSegments, where a user-friendly error can be surfaced at
 * download time instead.
 *
 * @callback ValidateFn
 * @param {string}  dataType - Storage key for this payload (e.g. "geometry", "route").
 *                             Matches the dataType declared in the site's interceptor rules.
 * @param {unknown} data     - Raw parsed JSON from the API response.
 * @returns {string|null}    - A human-readable error message if invalid; null if valid.
 */

/**
 * Returns true when enough data has been captured to produce a GPX file.
 *
 * Used by the popup's status check (getRouteStatus) to decide whether to
 * enable the Download button. Implementations should check for the minimum
 * required fields — typically just the geometry/coordinates data — so the
 * user can download as soon as the essential data arrives, even if optional
 * metadata (e.g. route title) has not been captured yet.
 *
 * @callback HasDataFn
 * @param {object|null} stored - The session-storage entry for the tab, or null
 *                               if nothing has been captured yet.
 * @returns {boolean}
 */

/**
 * Resolves the best human-readable title for the route.
 *
 * Must always return a non-empty string — the result is used directly as
 * the GPX <name> tag and as the download filename. Implementations should
 * provide graceful fallbacks (e.g. routeId, then a generic "route" string)
 * so a GPX file can always be named even when metadata was not captured.
 *
 * @callback ExtractTitleFn
 * @param {object}      stored   - The session-storage entry for the tab.
 * @param {string|null} routeId  - Route ID extracted from the tab URL by the
 *                                 popup (popup/sites.js extractRouteId). Used
 *                                 as a fallback when the captured metadata does
 *                                 not include a title.
 * @returns {string} A non-empty route title.
 */

/**
 * Converts the site's captured data into the site-agnostic segment format
 * consumed by gpx.js.
 *
 * The return value must conform to:
 *   Array<Segment>   where   Segment = Array<[lon, lat, ele?]>
 *
 * Longitude comes before latitude to match GeoJSON coordinate order.
 * Elevation is optional — omit the third element when the source data does
 * not include it.
 *
 * Implementations should throw a user-friendly Error (not return null or [])
 * when the required data is not yet available, so the error message reaches
 * the popup's download-result area rather than causing a silent failure.
 *
 * @callback ExtractSegmentsFn
 * @param {object} stored - The session-storage entry for the tab.
 * @returns {Array<Array<[number, number, number?]>>} One or more coordinate segments.
 * @throws {Error} If the required geometry data has not been captured yet.
 */

// ---------------------------------------------------------------------------
// AdapterBuilder typedef
//
// Groups the four callbacks into a single named type that adapter modules
// can reference with @implements and that assertAdapterContract checks at
// runtime.
// ---------------------------------------------------------------------------

/**
 * The contract every site adapter builder module must satisfy.
 *
 * An adapter module is a plain ES module that exports the four named
 * functions below. The background worker imports each adapter with
 * `import * as <site>Adapter` and registers it in the ADAPTERS map after
 * passing it through assertAdapterContract.
 *
 * @typedef  {Object}           AdapterBuilder
 * @property {ValidateFn}        validate        - Structural validation before storage.
 * @property {HasDataFn}         hasData         - Readiness check for the popup.
 * @property {ExtractTitleFn}    extractTitle    - Human-readable title resolution.
 * @property {ExtractSegmentsFn} extractSegments - Site-specific → generic coordinate conversion.
 */

// ---------------------------------------------------------------------------
// Runtime contract assertion
// ---------------------------------------------------------------------------

/** @type {ReadonlyArray<keyof AdapterBuilder>} */
const REQUIRED_METHODS = ["validate", "hasData", "extractTitle", "extractSegments"];

/**
 * Asserts that an adapter module exports all four AdapterBuilder methods and
 * that each export is a function.
 *
 * Call this at service-worker startup (when the ADAPTERS map is built) so
 * that a missing or misnamed export is caught immediately — before any user
 * interaction — rather than surfacing as a cryptic TypeError deep inside the
 * download flow.
 *
 * @param {string}  site    - The adapter's site identifier (used in error messages).
 * @param {unknown} adapter - The imported adapter module (result of `import * as …`).
 * @returns {AdapterBuilder} The same adapter reference, narrowed to AdapterBuilder.
 * @throws {Error} If any required method is absent or is not a function.
 *
 * @example
 * import { assertAdapterContract } from "../adapters/adapter-interface.js";
 * import * as bikemapAdapter from "../adapters/bikemap/builder.js";
 *
 * const ADAPTERS = {
 *   bikemap: assertAdapterContract("bikemap", bikemapAdapter),
 * };
 */
export function assertAdapterContract(site, adapter) {
  const missing = REQUIRED_METHODS.filter(
    (method) => typeof adapter?.[method] !== "function",
  );

  if (missing.length > 0) {
    throw new Error(
      `[AdapterBuilder] Adapter "${site}" is missing required method(s): ` +
        `${missing.map((m) => `"${m}"`).join(", ")}. ` +
        `Every adapter must export: ${REQUIRED_METHODS.map((m) => `"${m}"`).join(", ")}.`,
    );
  }

  return /** @type {AdapterBuilder} */ (adapter);
}
