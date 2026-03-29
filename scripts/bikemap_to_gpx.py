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
        description="Convert a Bikemap route to a GPX file.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("route_id", help="Bikemap route ID (e.g. 14289695)")
    parser.add_argument(
        "-o",
        "--output",
        metavar="FILE",
        default=None,
        help="Output GPX file path (default: <route title>.gpx or <route id>.gpx).",
    )
    return parser.parse_args()


# ──────────────────────────────────────────────────────────────────────────────
# Data fetching via Playwright
# ──────────────────────────────────────────────────────────────────────────────

# Sub-resource path tokens that appear in Bikemap URLs under /api/v6/routes/<id>/
# but do NOT represent the root route-metadata endpoint we want to capture.
_ROUTE_SUBRESOURCE_TOKENS = (
    "geometry",
    "pois",
    "metadata",
    "collections",
    "accommodations",
    "top-tour",
    "matched",
)


def fetch_route_data(route_id: str) -> tuple[dict | None, dict | None]:
    """Load the Bikemap route page and intercept the geometry and metadata responses.

    Returns
    -------
    (geometry_data, route_data)
        geometry_data – parsed JSON from the geometry/extended endpoint;
                        None if not captured.
        route_data    – parsed JSON from the route metadata endpoint;
                        None if not captured.
    """
    captured: dict[str, dict | None] = {"geometry": None, "route": None}

    def on_response(response) -> None:
        if not response.ok:
            return
        url = response.url
        if f"routes/{route_id}/geometry/extended" in url:
            try:
                captured["geometry"] = json.loads(response.text())
            except Exception:
                pass
        elif f"api/v6/routes/{route_id}/" in url and not any(
            token in url for token in _ROUTE_SUBRESOURCE_TOKENS
        ):
            try:
                captured["route"] = json.loads(response.text())
            except Exception:
                pass

    fetch_page(
        f"https://web.bikemap.net/r/{route_id}",
        on_response,
        wait_after=3_000,
    )

    return captured["geometry"], captured["route"]


# ──────────────────────────────────────────────────────────────────────────────
# Result reporting
# ──────────────────────────────────────────────────────────────────────────────


def print_results(
    output_path: str,
    title: str,
    geometry_data: dict,
    route_data: dict | None,
) -> None:
    coords = geometry_data["points"]["coordinates"]
    total_points = sum(len(seg) for seg in coords)

    print(f"GPX saved to : {output_path}")
    print(f"Route        : {title}")
    print(f"Segments     : {len(coords)}")
    print(f"Track points : {total_points}")
    if route_data:
        print(f"Distance     : {route_data.get('distance', 'N/A')} m")
        print(f"Ascent       : {route_data.get('ascent', 'N/A')} m")


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────


def main() -> None:
    args = parse_arguments()
    route_id = args.route_id

    print(f"Fetching route {route_id} …")
    geometry_data, route_data = fetch_route_data(route_id)

    if not geometry_data:
        print(
            "ERROR: Could not capture geometry data.\n"
            "  The route may be private, or Bikemap may have changed its API.\n"
            "  Try again, or open the page manually to check."
        )
        sys.exit(1)

    title = (route_data or {}).get("title") or route_id

    print(f"Building GPX for: {title}")
    segments = geometry_data["points"]["coordinates"]
    gpx_content = build_gpx(title, segments)

    output_path = args.output or f"{sanitize_filename(title)}.gpx"
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(gpx_content)

    print_results(output_path, title, geometry_data, route_data)


if __name__ == "__main__":
    main()
