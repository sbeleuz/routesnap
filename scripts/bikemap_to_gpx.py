import argparse
import json
import sys

from playwright.sync_api import sync_playwright


def parse_arguments():
    """Parse and return command-line arguments."""
    parser = argparse.ArgumentParser(description="Convert Bikemap routes to GPX format")
    parser.add_argument("route_id", type=str, help="Bikemap route ID (e.g., 14289695)")
    parser.add_argument(
        "-o",
        "--output",
        type=str,
        help="Output GPX file path (default: <route_title>.gpx or <route_id>.gpx)",
    )
    return parser.parse_args()


def fetch_route_data(route_id):
    """Fetch geometry and route data from Bikemap using Playwright.

    Args:
        route_id: The Bikemap route ID

    Returns:
        tuple: (geometry_data, route_data) - Both may be None if fetching fails
    """
    captured = {"geometry": None, "route": None}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        def on_response(response):
            url = response.url
            if f"routes/{route_id}/geometry/extended" in url:
                try:
                    captured["geometry"] = json.loads(response.text())
                except Exception:
                    pass
            elif (
                f"api/v6/routes/{route_id}/" in url
                and "geometry" not in url
                and "pois" not in url
                and "metadata" not in url
                and "collections" not in url
                and "accommodations" not in url
                and "top-tour" not in url
                and "matched" not in url
            ):
                try:
                    captured["route"] = json.loads(response.text())
                except Exception:
                    pass

        page.on("response", on_response)
        page.goto(f"https://web.bikemap.net/r/{route_id}", wait_until="networkidle")
        page.wait_for_timeout(3000)
        browser.close()

    return captured["geometry"], captured["route"]


def get_route_title(route_data, route_id):
    """Extract route title with fallback to route ID.

    Args:
        route_data: Dictionary containing route metadata
        route_id: The Bikemap route ID

    Returns:
        str: Route title or route ID as fallback
    """
    if route_data and route_data.get("title"):
        return route_data.get("title")
    return route_id


def escape_xml(text):
    """Escape the five characters that are special inside XML text/attributes.

    Applied to every user-supplied string before it is embedded in the output
    so that route titles containing &, <, >, " or ' produce valid XML.
    """
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def build_gpx(title, geometry_data):
    """Build GPX XML content from route and geometry data.

    Args:
        title: Route title
        geometry_data: Dictionary containing coordinates

    Returns:
        str: GPX XML content
    """
    coords = geometry_data["points"]["coordinates"]

    gpx = '<?xml version="1.0" encoding="UTF-8"?>\n'
    gpx += '<gpx version="1.1" creator="routesnap"\n'
    gpx += '  xmlns="http://www.topografix.com/GPX/1/1"\n'
    gpx += '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n'
    gpx += '  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n'
    gpx += "  <trk>\n"
    gpx += f"    <name>{escape_xml(title)}</name>\n"

    for segment in coords:
        gpx += "    <trkseg>\n"
        for point in segment:
            lon, lat = point[0], point[1]
            ele = point[2] if len(point) > 2 else None
            gpx += f'      <trkpt lat="{lat}" lon="{lon}">\n'
            if ele is not None:
                gpx += f"        <ele>{ele}</ele>\n"
            gpx += "      </trkpt>\n"
        gpx += "    </trkseg>\n"

    gpx += "  </trk>\n"
    gpx += "</gpx>\n"

    return gpx


def print_results(output_path, title, geometry_data, route_data):
    """Print route conversion results.

    Args:
        output_path: Path where GPX was saved
        title: Route title
        geometry_data: Dictionary containing coordinates
        route_data: Dictionary containing route metadata
    """
    coords = geometry_data["points"]["coordinates"]
    total_points = sum(len(seg) for seg in coords)

    print(f"GPX saved to: {output_path}")
    print(f"Route: {title}")
    print(f"Segments: {len(coords)}")
    print(f"Total points: {total_points}")
    if route_data:
        print(f"Distance: {route_data.get('distance', 'N/A')}m")
        print(f"Ascent: {route_data.get('ascent', 'N/A')}m")


def main():
    """Main entry point."""
    args = parse_arguments()

    route_id = args.route_id

    print(f"Fetching route {route_id}...")
    geometry_data, route_data = fetch_route_data(route_id)

    if not geometry_data:
        print("ERROR: Could not capture geometry data")
        sys.exit(1)

    title = get_route_title(route_data, route_id)

    print("Building GPX...")
    gpx_content = build_gpx(title, geometry_data)

    print("Saving GPX...")
    output_path = args.output or f"{title}.gpx"
    with open(output_path, "w") as f:
        f.write(gpx_content)

    print_results(output_path, title, geometry_data, route_data)


if __name__ == "__main__":
    main()
