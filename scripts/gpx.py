"""
Shared utilities for the routesnap route-to-GPX converter scripts.
"""

from __future__ import annotations

import re
from typing import Any, Callable

from playwright.sync_api import Page, Response, sync_playwright

# ──────────────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────────────

# A realistic desktop Chrome user-agent string that prevents most sites from
# returning bot-detection challenges instead of their normal HTML/API responses.
_DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# ──────────────────────────────────────────────────────────────────────────────
# XML / filename helpers
# ──────────────────────────────────────────────────────────────────────────────


def escape_xml(text: str) -> str:
    """Escape the five characters that are special in XML text and attributes.

    Applied to every user-supplied string before it is embedded in the GPX
    output so that titles containing ``&``, ``<``, ``>``, ``"`` or ``'``
    produce valid XML.
    """
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def sanitize_filename(name: str, fallback: str = "route") -> str:
    """Strip characters that are illegal in filenames on Windows, macOS and Linux.

    Parameters
    ----------
    name:
        The raw string to sanitise (e.g. a route title).
    fallback:
        Returned when *name* is empty after sanitisation.
    """
    safe = re.sub(r'[/\\:*?"<>|]', "_", name)
    safe = re.sub(r"\s+", " ", safe).strip().lstrip(".")
    return safe or fallback


# ──────────────────────────────────────────────────────────────────────────────
# GPX builder
# ──────────────────────────────────────────────────────────────────────────────


def build_gpx(title: str, segments: list[list[list[float]]]) -> str:
    """Build a GPX 1.1 document from a list of coordinate segments.

    Parameters
    ----------
    title:
        Human-readable route or segment name used as the GPX ``<name>`` tag.
    segments:
        List of track segments.  Each segment is a list of points; each point
        is a 2- or 3-element list **[longitude, latitude]** or
        **[longitude, latitude, elevation_metres]** following GeoJSON
        coordinate order (longitude before latitude).

    Returns
    -------
    str
        A well-formed GPX 1.1 XML document.
    """
    gpx = '<?xml version="1.0" encoding="UTF-8"?>\n'
    gpx += '<gpx version="1.1" creator="routesnap"\n'
    gpx += '  xmlns="http://www.topografix.com/GPX/1/1"\n'
    gpx += '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n'
    gpx += '  xsi:schemaLocation="http://www.topografix.com/GPX/1/1'
    gpx += ' http://www.topografix.com/GPX/1/1/gpx.xsd">\n'
    gpx += "  <trk>\n"
    gpx += f"    <name>{escape_xml(title)}</name>\n"

    for segment in segments:
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


# ──────────────────────────────────────────────────────────────────────────────
# Playwright helper
# ──────────────────────────────────────────────────────────────────────────────


def fetch_page(
    url: str,
    on_response: Callable[[Response], None],
    *,
    post_load: Callable[[Page], Any] | None = None,
    user_agent: str = _DEFAULT_USER_AGENT,
    timeout: int = 30_000,
    wait_after: int = 3_000,
) -> Any:
    """Load *url* in a headless Chromium browser and intercept its responses.

    Parameters
    ----------
    url:
        The page URL to load.
    on_response:
        Callable invoked for every HTTP response the page triggers.  Use it
        to capture API payloads by inspecting ``response.url`` and reading
        ``response.text()``.
    post_load:
        Optional callable invoked with the live Playwright ``Page`` object
        after the page has settled (*networkidle* + *wait_after* ms).  Its
        return value is forwarded to the caller.  Use it to read DOM state
        (e.g. ``page.title()``).
    user_agent:
        Browser user-agent string.  Defaults to a realistic desktop Chrome
        UA so that most sites serve their regular HTML instead of a challenge.
    timeout:
        Maximum milliseconds to wait for the initial page load.
    wait_after:
        Additional milliseconds to pause after *networkidle* so that any
        late-arriving XHRs can complete before the browser is closed.

    Returns
    -------
    Any
        Whatever *post_load* returns, or ``None`` when *post_load* is omitted.
    """
    result = None

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=user_agent,
            viewport={"width": 1280, "height": 900},
            locale="en-US",
        )
        page = context.new_page()
        page.on("response", on_response)

        page.goto(url, wait_until="networkidle", timeout=timeout)
        page.wait_for_timeout(wait_after)

        if post_load is not None:
            result = post_load(page)

        browser.close()

    return result
