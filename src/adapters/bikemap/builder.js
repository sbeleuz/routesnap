/**
 * Bikemap Adapter — Builder (ES module, background service worker)
 *
 * Contains all Bikemap-specific knowledge needed by the background worker:
 *  • Data validation — rejects structurally invalid payloads early
 *  • Title extraction — resolves the best human-readable name for the route
 *  • Segment extraction — converts Bikemap's geometry shape into the
 *    site-agnostic [[lon, lat, ele?], …][] format consumed by gpx.js
 *  • Readiness check — tells the background whether enough data has been
 *    captured to attempt a download
 *
 * @implements {import('../adapter-interface.js').AdapterBuilder}
 */

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** @type {import('../adapter-interface.js').ValidateFn} */
export function validate(dataType, data) {
  if (dataType === "geometry") {
    if (!data || typeof data !== "object") {
      return "Geometry data is not an object";
    }
    if (!data.points || typeof data.points !== "object") {
      return "Geometry data is missing the 'points' field";
    }
    if (!Array.isArray(data.points.coordinates)) {
      return "Geometry data is missing 'points.coordinates' array";
    }
    if (data.points.coordinates.length === 0) {
      return "Geometry data contains no coordinate segments";
    }
  }

  if (dataType === "route") {
    if (!data || typeof data !== "object") {
      return "Route data is not an object";
    }
  }

  return null; // valid
}

// ---------------------------------------------------------------------------
// Readiness check
// ---------------------------------------------------------------------------

/** @type {import('../adapter-interface.js').HasDataFn} */
export function hasData(stored) {
  return !!stored?.geometry?.points?.coordinates;
}

// ---------------------------------------------------------------------------
// Title extraction
// ---------------------------------------------------------------------------

/** @type {import('../adapter-interface.js').ExtractTitleFn} */
export function extractTitle(stored, routeId) {
  return stored?.route?.title || routeId || "route";
}

// ---------------------------------------------------------------------------
// Segment extraction
// ---------------------------------------------------------------------------

/** @type {import('../adapter-interface.js').ExtractSegmentsFn} */
export function extractSegments(stored) {
  if (!hasData(stored)) {
    throw new Error(
      "Route geometry not captured yet. " +
        "Please wait for the page to finish loading and try again.",
    );
  }
  return stored.geometry.points.coordinates;
}
