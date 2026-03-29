# RouteSnap Scripts

Standalone Python scripts that extract routes/segments from cycling websites and convert them to GPX files using Playwright.

---

# Requirements

- Python 3.7+
- Playwright
- A valid route/segment id

---

# Installation

1. Create and activate a virtual environment:

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   ```

2. Install dependencies:

   ```bash
   pip install playwright
   ```

3. Install Playwright browsers:
   ```bash
   playwright install chromium
   ```

---

# Bikemap

Convert a Bikemap route into a GPX track file.

## How it works

Bikemap's route page triggers two unauthenticated AJAX calls that together
contain all the information needed to build a GPX file:

```
GET /api/v6/routes/<id>/geometry/extended → coordinate geometry
GET /api/v6/routes/<id>/ → route metadata (title, distance, ascent)
```

This script intercepts those responses with Playwright and writes a GPX 1.1
file named after the route title.

## Usage

```bash
.venv/bin/python bikemap_to_gpx.py 14289695
.venv/bin/python bikemap_to_gpx.py 14289695 -o my_route.gpx
```

# Strava Segments

Convert a public Strava segment page into a GPX track file.

### How it works

Strava's segment page triggers a single unauthenticated AJAX call to:

```
GET /stream/segments/<id>?streams[]=latlng&streams[]=distance&streams[]=altitude
```

That response contains three parallel arrays:

- latlng – [[lat, lon], …] one pair per sample point
- altitude – [metres, …] elevation at each sample
- distance – [metres, …] cumulative distance at each sample

This script intercepts that response with Playwright, pulls the segment
title from the page <title> element, and writes a GPX 1.1 file.

### Usage

```bash
.venv/bin/python strava_segment_to_gpx.py 39414139
.venv/bin/python strava_segment_to_gpx.py 39414139 -o my_segment.gpx
```
