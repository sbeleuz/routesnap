from __future__ import annotations

import argparse
import json
import sys

from gpx import build_gpx, fetch_page, sanitize_filename

# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert a Strava segment to a GPX file.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("segment_id", help="Strava segment ID (e.g. 39414139)")
    parser.add_argument(
        "-o",
        "--output",
        metavar="FILE",
        default=None,
        help="Output GPX file path (default: <segment_title>.gpx or <segment_id>.gpx).",
    )
    return parser.parse_args()


def segment_url(segment_id: str) -> str:
    """Build the Strava segment URL from a segment ID."""
    return f"https://www.strava.com/segments/{segment_id}"


# ──────────────────────────────────────────────────────────────────────────────
# Data fetching via Playwright
# ──────────────────────────────────────────────────────────────────────────────


def _stream_to_segments(stream_data: dict) -> list[list[list[float]]]:
    """Convert Strava stream data to the site-agnostic [lon, lat, ele?] segment format.

    Strava's stream API returns latlng as [lat, lon] pairs (latitude first).
    The shared build_gpx expects GeoJSON coordinate order: [lon, lat, ele?].
    This function swaps the order and merges the parallel altitude array.

    Returns a list containing a single segment (Strava segments are one
    continuous track), matching the multi-segment format expected by build_gpx.
    """
    latlng: list[list[float]] = stream_data["latlng"]
    altitude: list[float] = stream_data.get("altitude", [])

    points: list[list[float]] = []
    for i, (lat, lon) in enumerate(latlng):
        point: list[float] = [lon, lat]
        if i < len(altitude):
            point.append(altitude[i])
        points.append(point)

    return [points]


def fetch_segment_data(segment_id: str, url: str) -> tuple[dict | None, str]:
    """Load the Strava segment page and intercept the stream API response.

    Returns
    -------
    (stream_data, title)
        stream_data – parsed JSON from /stream/segments/<id> with keys
                      'latlng', 'altitude', 'distance'; None if not captured.
        title       – human-readable segment name (falls back to segment_id).
    """
    captured: dict[str, dict | None] = {"stream": None}

    def on_response(response) -> None:
        # The stream endpoint path: /stream/segments/<id>
        # (The URL also carries a cache-busting _=<timestamp> query param.)
        if f"/stream/segments/{segment_id}" in response.url and response.ok:
            try:
                captured["stream"] = json.loads(response.text())
            except Exception:
                pass

    raw_title: str = fetch_page(
        url,
        on_response,
        # Read the page title after load; Strava titles look like:
        # "Segment Name | Strava Ride Segment in City"
        post_load=lambda p: p.title(),
        wait_after=2_000,
    )

    # Strip the " | Strava …" suffix to get just the segment name.
    title = raw_title.split("|")[0].strip() if raw_title else ""
    title = title or segment_id

    return captured["stream"], title


# ──────────────────────────────────────────────────────────────────────────────
# Result reporting
# ──────────────────────────────────────────────────────────────────────────────


def print_results(
    output_path: str,
    title: str,
    stream_data: dict,
) -> None:
    latlng: list = stream_data["latlng"]
    altitude: list = stream_data.get("altitude", [])
    distance: list = stream_data.get("distance", [])

    total_distance_m = distance[-1] if distance else 0
    ele_min = min(altitude) if altitude else None
    ele_max = max(altitude) if altitude else None

    print(f"GPX saved to : {output_path}")
    print(f"Segment      : {title}")
    print(f"Track points : {len(latlng)}")
    print(f"Distance     : {total_distance_m / 1000:.2f} km")
    if ele_min is not None and ele_max is not None:
        print(f"Elevation    : {ele_min:.0f} m – {ele_max:.0f} m")


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────


def main() -> None:
    args = parse_arguments()
    segment_id = args.segment_id
    url = segment_url(segment_id)

    print(f"Fetching segment {segment_id} …")
    stream_data, title = fetch_segment_data(segment_id, url)

    if stream_data is None:
        print(
            "ERROR: Could not capture stream data.\n"
            "  The segment may be private, or Strava may have changed its API.\n"
            "  Try again, or open the page manually to check."
        )
        sys.exit(1)

    if not stream_data.get("latlng"):
        print("ERROR: Stream data captured but 'latlng' array is missing or empty.")
        sys.exit(1)

    print(f"Building GPX for: {title}")
    segments = _stream_to_segments(stream_data)
    gpx_content = build_gpx(title, segments)

    output_path = args.output or f"{sanitize_filename(title, fallback='segment')}.gpx"
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(gpx_content)

    print_results(output_path, title, stream_data)


if __name__ == "__main__":
    main()
