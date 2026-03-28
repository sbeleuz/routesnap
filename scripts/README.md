# Bikemap to GPX Converter

A Python script that extracts Bikemap routes and converts them to GPX files.

## Description

This script automates the process of downloading route data from Bikemap.net and converting it into GPX format, which can be imported into most GPS devices and mapping applications. It uses Playwright to fetch the route geometry and metadata from Bikemap's API.

## Requirements

- Python 3.7+
- Playwright
- A valid Bikemap route ID

## Installation

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

## Usage

Convert a Bikemap route to GPX by providing a route ID:

```bash
python bikemap_to_gpx.py 14289695
```

This will create a GPX file named after the route title (or the route ID if title is unavailable).

## Finding Your Route ID

You can find the route ID in the Bikemap URL:

- Navigate to your desired route on bikemap.net
- The URL will look like: `https://web.bikemap.net/r/14289695`
- The number at the end (`14289695`) is your route ID

## Output

The script generates a GPX file containing:

- Track segments with all waypoints from the route
- Latitude and longitude for each point
- Elevation data (if available)
- Route name

## How It Works

1. **Fetch Route Data**: Uses Playwright to load the Bikemap route page and intercept API responses
2. **Extract Geometry**: Captures the route geometry data containing all waypoints
3. **Extract Metadata**: Captures route information including title, distance, and ascent
4. **Build GPX**: Constructs a valid GPX 1.1 XML file with the collected data
5. **Save File**: Writes the GPX content to the specified output file
