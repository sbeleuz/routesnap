/**
 * Strava Segment Adapter — Builder (ES module, background service worker)
 *
 * Contains all Strava-segment-specific knowledge needed by the background worker:
 *  • Data validation — rejects structurally invalid payloads early
 *  • Title extraction — resolves the best human-readable name for the segment
 *  • Segment extraction — converts Strava's [lat, lon] stream format into the
 *    site-agnostic [[lon, lat, ele?], …][] format consumed by gpx.js
 *  • Readiness check — tells the background whether enough data has been
 *    captured to attempt a download
 *
 * Captured dataTypes
 * ──────────────────
 *  stream   — /stream/segments/<id> response; carries `latlng`, `altitude`,
 *             and `distance` arrays. This is the only field required to build
 *             a GPX file.
 *  metadata — Synthetic payload posted by the interceptor after reading
 *             document.title; carries `{ title }`. Optional — the builder
 *             falls back to routeId when it is absent.
 *
 * @implements {import('../adapter-interface.js').AdapterBuilder}
 */

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** @type {import('../adapter-interface.js').ValidateFn} */
export function validate(dataType, data) {
  if (dataType === "stream") {
    if (!data || typeof data !== "object") {
      return "Stream data is not an object";
    }
    if (!Array.isArray(data.latlng)) {
      return "Stream data is missing the 'latlng' array";
    }
    if (data.latlng.length === 0) {
      return "Stream data 'latlng' array is empty";
    }
    // Spot-check the first point: must be a [lat, lon] pair of numbers.
    const first = data.latlng[0];
    if (
      !Array.isArray(first) ||
      first.length < 2 ||
      typeof first[0] !== "number" ||
      typeof first[1] !== "number"
    ) {
      return "Stream data 'latlng' entries must be [lat, lon] number pairs";
    }
    // altitude is optional, but if present it must be a number array.
    if (data.altitude !== undefined) {
      if (!Array.isArray(data.altitude)) {
        return "Stream data 'altitude' field must be an array";
      }
    }
  }

  if (dataType === "metadata") {
    if (!data || typeof data !== "object") {
      return "Metadata is not an object";
    }
    if (typeof data.title !== "string" || data.title.trim() === "") {
      return "Metadata is missing a non-empty 'title' string";
    }
  }

  return null; // valid
}

// ---------------------------------------------------------------------------
// Readiness check
// ---------------------------------------------------------------------------

/** @type {import('../adapter-interface.js').HasDataFn} */
export function hasData(stored) {
  return (
    Array.isArray(stored?.stream?.latlng) && stored.stream.latlng.length > 0
  );
}

// ---------------------------------------------------------------------------
// Title extraction
// ---------------------------------------------------------------------------

/** @type {import('../adapter-interface.js').ExtractTitleFn} */
export function extractTitle(stored, routeId) {
  // Prefer the title captured from document.title by the interceptor.
  // Fall back to the segment ID extracted from the URL, then a generic label.
  return stored?.metadata?.title || routeId || "segment";
}

// ---------------------------------------------------------------------------
// Segment extraction
// ---------------------------------------------------------------------------

/**
 * Converts Strava's parallel stream arrays into the site-agnostic segment
 * format expected by gpx.js.
 *
 * Strava returns latlng as [lat, lon] pairs (latitude first), whereas gpx.js
 * expects GeoJSON coordinate order: [lon, lat, ele?].
 *
 * A Strava segment is one continuous track, so we always return a single
 * segment (an array containing one coordinate array).
 *
 * @type {import('../adapter-interface.js').ExtractSegmentsFn}
 */
export function extractSegments(stored) {
  if (!hasData(stored)) {
    throw new Error(
      "Segment stream data not captured yet. " +
        "Please wait for the page to finish loading and try again.",
    );
  }

  const latlng = stored.stream.latlng; // [[lat, lon], …]
  const altitude = stored.stream.altitude ?? []; // [ele, …] — optional

  /** @type {Array<[number, number, number?]>} */
  const points = latlng.map(([lat, lon], i) => {
    /** @type {[number, number, number?]} */
    const point = [lon, lat];
    if (i < altitude.length) {
      point.push(altitude[i]);
    }
    return point;
  });

  // Wrap in an outer array — gpx.js expects Array<Segment> where each
  // Segment is an Array<[lon, lat, ele?]>. Strava segments are always a
  // single continuous track, so we return exactly one segment.
  return [points];
}
