/**
 * Generic GPX Document Builder — ES module, background service worker
 *
 * Knows nothing about any specific site or data shape. It only knows the
 * GPX 1.1 format. All site-specific concerns (extracting segments and titles
 * from captured API data) are handled by each adapter's builder.js.
 *
 * Public API
 * ──────────
 *  buildGpxDocument(title, segments) → string
 *
 * Where `segments` is the site-agnostic format produced by every adapter:
 *
 *   Array<Segment>   where   Segment = Array<[lon, lat, ele?]>
 *
 * Example:
 *   [
 *     [ [13.4, 52.5, 42], [13.5, 52.6, 45] ],   // trkseg 0
 *     [ [13.6, 52.7, 50], [13.7, 52.8, 55] ],   // trkseg 1
 *   ]
 */

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/**
 * Builds a complete, valid GPX 1.1 document string from a title and an array
 * of track segments.
 *
 * The caller (background/index.js) is responsible for obtaining `title` and
 * `segments` from the appropriate adapter so this function stays site-agnostic.
 *
 * @param {string}                            title    - Track name (will be XML-escaped)
 * @param {Array<Array<[number, number, number?]>>} segments - Array of coordinate segments
 * @returns {string} Full GPX XML document
 */
export function buildGpxDocument(title, segments) {
  const segmentsXml = segments.map(buildTrackSegment).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="routesnap"',
    '  xmlns="http://www.topografix.com/GPX/1/1"',
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    "  <trk>",
    `    <name>${escapeXml(title)}</name>`,
    segmentsXml,
    "  </trk>",
    "</gpx>",
    "", // trailing newline
  ].join("\n");
}

// ---------------------------------------------------------------------------
// GPX element builders (private)
// ---------------------------------------------------------------------------

/**
 * Builds a <trkseg> element containing one <trkpt> per coordinate.
 *
 * @param {Array<[number, number, number?]>} points
 * @returns {string}
 */
function buildTrackSegment(points) {
  return ["    <trkseg>", ...points.map(buildTrackPoint), "    </trkseg>"].join(
    "\n",
  );
}

/**
 * Builds a single <trkpt> element from a [lon, lat, ele?] coordinate triple.
 *
 * Elevation is omitted entirely when not present so the output stays valid
 * GPX 1.1 regardless of whether the source data includes elevation.
 *
 * @param {[number, number, number?]} point
 * @returns {string}
 */
function buildTrackPoint([lon, lat, ele]) {
  const eleTag = ele != null ? `\n        <ele>${ele}</ele>` : "";
  return `      <trkpt lat="${lat}" lon="${lon}">${eleTag}\n      </trkpt>`;
}

// ---------------------------------------------------------------------------
// XML escaping
// ---------------------------------------------------------------------------

/**
 * Escapes the five characters that are special inside XML text / attributes.
 * Applied to every user-supplied string before it is embedded in the output.
 *
 * @param {string|null|undefined} str
 * @returns {string}
 */
export function escapeXml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
